import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import {
  ROOT, LOCAL, CONFIG, ACTIVE, binaryName, exists, normalize, loadConfig, runtimeCheck,
  buildTools, available, databaseReachable, checkPexels, atomicJSON, runtimeEnv,
  ensureSecrets, exec, digest, fingerprint, artifactInfo, filesDigest, fail,
} from './common.mjs';

async function ask(label, fallback = '', secret = false) {
  let output = process.stdout;
  if (secret) {
    output = new Writable({ write(chunk, encoding, callback) { callback(); } });
    process.stdout.write(`${label}${fallback ? ` [${fallback}]` : ''}: `);
  }
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const value = await rl.question(secret ? '' : `${label}${fallback ? ` [${fallback}]` : ''}: `);
    if (secret) process.stdout.write('\n');
    return value || fallback;
  } finally { rl.close(); }
}
async function configuration() {
  if (await exists(CONFIG)) return loadConfig();
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('首次初始化需要交互终端，或先复制 voex.config.example.json 为 voex.config.json 并填写。');
  console.log('首次配置。密码和 Key 输入时不显示；留空采用默认值。');
  const result = {
    host: await ask('HTTP 监听地址', '127.0.0.1'),
    port: Number(await ask('HTTP 端口', '8080')),
    database: {
      host: await ask('MySQL 地址', '127.0.0.1'),
      port: Number(await ask('MySQL 端口', '3306')),
      user: await ask('MySQL 用户名', 'voex'),
      password: await ask('MySQL 密码（允许为空）', '', true),
      name: await ask('MySQL 数据库名', 'voex'),
    },
    pexelsKey: await ask('Pexels Key（留空禁用图库）', '', true),
    collaboration: /^(y|yes)$/i.test(await ask('启用多人协同？y/n', 'n')),
  };
  if (result.collaboration) {
    result.collaborationPort = Number(await ask('协同内部端口', '8091'));
    result.publicUrl = await ask('浏览器访问地址（协议、域名和端口）', `http://localhost:${result.port}`);
  }
  const config = normalize(result);
  await atomicJSON(CONFIG, config);
  console.log('已写入 voex.config.json（已被 Git 忽略）。');
  return config;
}
async function mathjax(webRoot) {
  // Fixed version and checksum match the existing deployment; keep its license with the bundle.
  const assets = [
    ['tex-svg.js', 'es5/tex-svg.js', 'd4295dc33744836935c1399feece5159577b34c5c8ffb9f1c6324cd82e03a882'],
    ['mathjax-LICENSE.txt', 'LICENSE', 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'],
  ];
  await fs.mkdir(path.join(LOCAL, 'cache'), { recursive: true });
  await fs.mkdir(path.join(webRoot, 'vendor'), { recursive: true });
  for (const [filename, remote, sha] of assets) {
    const cache = path.join(LOCAL, 'cache', `mathjax-3.2.2-${filename}`);
    let data = await exists(cache) ? await fs.readFile(cache) : null;
    if (!data || digest(data) !== sha) {
      console.log(`下载固定版本 MathJax 3.2.2 ${filename} 并校验摘要…`);
      const response = await fetch(`https://cdn.jsdelivr.net/npm/mathjax@3.2.2/${remote}`, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`公式资源下载失败（HTTP ${response.status}）。`);
      data = Buffer.from(await response.arrayBuffer());
      if (digest(data) !== sha) throw new Error('公式资源摘要不匹配，已停止初始化。');
      await fs.writeFile(cache, data);
    }
    await fs.writeFile(path.join(webRoot, 'vendor', filename), data);
  }
}
async function initialize() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node scripts/init.mjs [--no-start] [--check]\n默认：填写/检查配置、构建并前台运行。\n--no-start：完成初始化和打包后退出。\n--check：仅检查已有配置、工具、端口及 Pexels；不写配置、不构建、不验证数据库账号/表结构。');
    return;
  }
  if (args.some(arg => !['--no-start', '--check'].includes(arg))) throw new Error('未知参数，请使用 --help。');
  runtimeCheck();
  const config = args.includes('--check') ? await loadConfig() : await configuration();
  buildTools();
  await available(config.host, config.port);
  if (config.collaboration) await available('127.0.0.1', config.collaborationPort);
  await databaseReachable(config);
  await checkPexels(config);
  if (args.includes('--check')) { console.log('基础检查通过；完整数据库账号和表结构将在初始化打包时检查。'); return; }
  await fs.mkdir(path.join(LOCAL, 'releases'), { recursive: true, mode: 0o700 });
  const lock = path.join(LOCAL, 'init.lock');
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('已有初始化任务，或上次异常退出留下 .voex/init.lock；确认没有任务后移除该文件再试。');
    throw error;
  }
  await handle.writeFile(String(process.pid));
  try {
    await ensureSecrets();
    const id = `${Date.now()}-${randomBytes(4).toString('hex')}`;
    const release = path.join(LOCAL, 'releases', id);
    await fs.mkdir(path.join(release, 'web'), { recursive: true });
    const env = runtimeEnv(config, release);
    const envText = Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
    await fs.writeFile(path.join(release, 'server.env'), envText, { mode: 0o600, flag: 'wx' });
    console.log('构建当前平台的 Go API，并检查数据库账号及所需表…');
    const goEnv = { ...process.env, GOOS: process.platform === 'win32' ? 'windows' : 'linux', GOARCH: process.arch === 'x64' ? 'amd64' : 'arm64', CGO_ENABLED: '0' };
    await exec('go', ['build', '-mod=readonly', '-trimpath', '-o', path.join(release, binaryName), './cmd/voex-server'], { cwd: path.join(ROOT, 'server'), env: goEnv });
    await exec(path.join(release, binaryName), ['check-config'], { cwd: ROOT, env: { ...process.env, ...env } });
    console.log('安装锁定版本依赖并打包前端…');
    await exec('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: path.join(ROOT, 'web') });
    await exec('pnpm', ['run', 'type-check'], { cwd: path.join(ROOT, 'web') });
    await exec(process.execPath, [path.join(ROOT, 'scripts/build-web.mjs')], {
      cwd: path.join(ROOT, 'web'),
      env: { ...process.env, VITE_PEXELS_API_KEY: config.pexelsKey, VOEX_BUILD_WEB_ROOT: path.join(release, 'web'), NODE_OPTIONS: '--max-old-space-size=1024' },
    });
    await mathjax(path.join(release, 'web'));
    let collaboration = null;
    if (config.collaboration) {
      console.log('打包多人协同服务…');
      const cwd = path.join(ROOT, 'server/collab');
      await exec('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd });
      await exec('pnpm', ['run', 'type-check'], { cwd });
      await exec('pnpm', ['run', 'build'], { cwd, env: { ...process.env, VOEX_COLLAB_SCHEMA_SOURCE: path.join(ROOT, 'web/packages/editor-schema/src/index.ts') } });
      await fs.cp(path.join(cwd, 'dist'), path.join(release, 'collab'), { recursive: true });
      await fs.writeFile(path.join(release, 'collab/package.json'), '{"type":"module","private":true}\n');
      collaboration = await filesDigest(path.join(release, 'collab'));
    }
    const info = await artifactInfo(release);
    await atomicJSON(ACTIVE, { version: 1, root: ROOT, release: id, platform: process.platform, arch: process.arch,
      config: fingerprint(config), environment: digest(envText), ...info, collaboration });
    console.log('初始化完成。以后仅启动：node scripts/run.mjs');
  } finally {
    await handle.close();
    await fs.unlink(lock);
  }
  if (!args.includes('--no-start')) {
    const { start } = await import('./run.mjs');
    await start();
  }
}
initialize().catch(fail);
