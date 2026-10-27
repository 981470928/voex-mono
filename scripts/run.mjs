import { promises as fs } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import {
  ROOT, LOCAL, ACTIVE, binaryName, exists, readJSON, runtimeCheck, loadConfig, fingerprint,
  runtimeEnv, digest, artifactInfo, filesDigest, available, exec, command, fail,
} from './common.mjs';

async function prepared() {
  runtimeCheck();
  if (!await exists(ACTIVE)) throw new Error('尚未初始化或打包未完成，请先执行 node scripts/init.mjs。');
  let state;
  try { state = await readJSON(ACTIVE); } catch { throw new Error('初始化状态损坏，请重新执行 node scripts/init.mjs。'); }
  if (state.version !== 1 || !/^[0-9]+-[0-9a-f]+$/.test(state.release)) throw new Error('初始化状态无效，请重新初始化。');
  if (state.root !== ROOT || state.platform !== process.platform || state.arch !== process.arch)
    throw new Error('目录位置或运行平台已改变，请在当前电脑重新执行 node scripts/init.mjs。');
  const config = await loadConfig();
  if (state.config !== fingerprint(config)) throw new Error('配置已变更，请执行 node scripts/init.mjs 重新检查并打包。');
  const release = path.join(LOCAL, 'releases', state.release);
  try {
    const actual = await artifactInfo(release);
    if (actual.binary !== state.binary || actual.web !== state.web || digest(await fs.readFile(path.join(release, 'server.env'))) !== state.environment)
      throw new Error('modified');
    if (config.collaboration && (await filesDigest(path.join(release, 'collab'))) !== state.collaboration) throw new Error('modified');
  } catch { throw new Error('构建产物或生成配置缺失/已变更，请先执行 node scripts/init.mjs。'); }
  const env = { ...process.env, ...runtimeEnv(config, release) };
  await exec(path.join(release, binaryName), ['check-config'], { cwd: ROOT, env });
  return { config, release, env };
}
async function ready(url, stopped) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (stopped()) throw new Error('服务在就绪前退出。');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('服务启动超过30秒仍未就绪，请查看上方日志。');
}
export async function start({ check = false } = {}) {
  const { config, release, env } = await prepared();
  if (check) { console.log('配置、数据库及构建产物检查通过，未启动服务。'); return; }
  await available(config.host, config.port);
  if (config.collaboration) await available('127.0.0.1', config.collaborationPort);
  let stopping = false;
  let failed = false;
  let stopPromise;
  let apiChild;
  let collaborationChild;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const alive = child => child?.pid && child.exitCode === null && child.signalCode === null;
  async function terminate(child) {
    if (!alive(child)) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 28000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }
  function stop(error) {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      if (error) { failed = true; console.error(`\n错误：${error.message}`); }
      console.log('\n正在停止服务…');
      if (alive(collaborationChild)) {
        try {
          const secret = (await fs.readFile(env.VOEX_COLLAB_SECRET_FILE, 'utf8')).trim();
          const response = await fetch(`http://127.0.0.1:${config.collaborationPort}/internal/collab/drain`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Collab-Secret': secret },
            body: '{}', signal: AbortSignal.timeout(28000),
          });
          const result = await response.json();
          if (!response.ok || result.success !== true) throw new Error('drain failed');
          console.log('协同编辑已持久化，正在依次停止协同服务和 Go API。');
        } catch {
          failed = true;
          stopping = false;
          stopPromise = undefined;
          console.error('协同编辑排空失败，已保留服务运行以避免丢失未落库编辑。请检查日志和数据库后，再按 Ctrl+C 重试。');
          return;
        }
      }
      await terminate(collaborationChild);
      await terminate(apiChild);
      resolveDone();
    })();
    return stopPromise;
  }
  function launch(label, file, args, options) {
    const child = command(file, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, windowsHide: true, ...options });
    child.stdout?.pipe(process.stdout, { end: false });
    child.stderr?.pipe(process.stderr, { end: false });
    child.once('error', () => { stop(new Error(`${label} 无法启动。`)); });
    child.once('exit', code => { if (!stopping) stop(new Error(`${label} 意外退出（${code ?? 'signal'}）。`)); });
    return child;
  }
  const onSignal = () => { stop(); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    apiChild = launch('Go API', path.join(release, binaryName), ['serve'], { cwd: ROOT, env });
    if (config.collaboration) {
      collaborationChild = launch('协同服务', process.execPath, [path.join(release, 'collab/server.js')], { cwd: release, env: {
        ...process.env, NODE_ENV: 'production', VOEX_COLLAB_HOST: '127.0.0.1', VOEX_COLLAB_PORT: String(config.collaborationPort),
        VOEX_COLLAB_API_URL: `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host === '::' ? '[::1]' : net.isIP(config.host) === 6 ? `[${config.host}]` : config.host}:${config.port}`,
        VOEX_COLLAB_SECRET_FILE: env.VOEX_COLLAB_SECRET_FILE, VOEX_COLLAB_ORIGINS: config.publicUrl,
      } });
    }
    const host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host === '::' ? '[::1]' : net.isIP(config.host) === 6 ? `[${config.host}]` : config.host;
    const origin = `http://${host}:${config.port}`;
    await ready(`${origin}/api/health/ready`, () => stopping);
    if (config.collaboration) await ready(`http://127.0.0.1:${config.collaborationPort}/health/ready`, () => stopping);
    if (!stopping) console.log(`\nVoex 已启动：${origin}/app/\n按 Ctrl+C 停止全部服务。`);
    await done;
  } catch (error) { if (!stopping) await stop(error); await done; }
  finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) console.log('node scripts/run.mjs [--check]\n只检查并运行已有构建，不安装依赖、不打包。\n--check：只检查配置、数据库及构建产物，不启动服务。');
  else if (args.some(arg => arg !== '--check')) fail(new Error('未知参数，请使用 --help。'));
  else start({ check: args.includes('--check') }).catch(fail);
}
