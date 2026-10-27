import { promises as fs } from 'node:fs';
import { command, available } from './common.mjs';

const alive = child => child?.pid && child.exitCode === null && child.signalCode === null;

async function waitForReady(targets, stopped, timeout = 60000) {
  const deadline = Date.now() + timeout;
  const pending = new Set(targets);
  while (pending.size) {
    if (stopped()) throw new Error('服务在就绪前退出。');
    for (const target of [...pending]) {
      try {
        const response = await fetch(target.url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
        await response.body?.cancel();
        if (response.ok) pending.delete(target);
      } catch {}
    }
    if (!pending.size) return;
    if (Date.now() > deadline)
      throw new Error(`${[...pending].map(target => target.label).join('、')} 启动超过 ${Math.round(timeout / 1000)} 秒仍未就绪，请查看上方日志。`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function terminate(child) {
  if (!alive(child)) return;
  await new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (alive(child)) child.kill('SIGKILL');
      setTimeout(finish, 1000);
    }, 28000);
    child.once('close', finish);
    if (!child.kill('SIGTERM')) finish();
  });
}

/**
 * Launch the Go API (and optional collaboration/extra processes), wait for
 * readiness, then block until Ctrl+C or an unexpected exit.
 */
export async function runServices({ config, env, api, collab, extras = [], ready, banner }) {
  await available(config.host, config.port);
  if (collab) await available('127.0.0.1', config.collaborationPort);
  let stopping = false;
  let failed = false;
  let stopPromise;
  let apiChild;
  let collabChild;
  const extraChildren = [];
  let resolveDone;
  const done = new Promise(resolve => {
    resolveDone = resolve;
  });

  function stop(error) {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      if (error) {
        failed = true;
        console.error(`\n错误：${error.message}`);
      }
      console.log('\n正在停止服务…');
      if (alive(collabChild)) {
        try {
          const secret = (await fs.readFile(env.VOEX_COLLAB_SECRET_FILE, 'utf8')).trim();
          const response = await fetch(`http://127.0.0.1:${config.collaborationPort}/internal/collab/drain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Collab-Secret': secret },
            body: '{}',
            signal: AbortSignal.timeout(28000),
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
      await terminate(collabChild);
      for (const child of [...extraChildren].reverse()) await terminate(child);
      await terminate(apiChild);
      resolveDone();
    })();
    return stopPromise;
  }

  function launch(label, file, args, options) {
    const child = command(file, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, windowsHide: true, ...options });
    child.stdout?.pipe(process.stdout, { end: false });
    child.stderr?.pipe(process.stderr, { end: false });
    child.once('error', () => stop(new Error(`${label} 无法启动。`)));
    child.once('exit', code => {
      if (!stopping) stop(new Error(`${label} 意外退出（${code ?? 'signal'}）。`));
    });
    return child;
  }

  const onSignal = () => stop();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    apiChild = launch('Go API', api.file, api.args, { cwd: api.cwd, env: { ...process.env, ...env } });
    if (collab) collabChild = launch('协同服务', collab.file, collab.args, { cwd: collab.cwd, env: collab.env });
    for (const extra of extras) extraChildren.push(launch(extra.label, extra.file, extra.args, { cwd: extra.cwd, env: extra.env }));
    await waitForReady(ready, () => stopping);
    if (!stopping) console.log(`\n${banner}\n按 Ctrl+C 停止全部服务。`);
    await done;
  } catch (error) {
    if (!stopping) await stop(error);
    await done;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  if (failed) process.exitCode = 1;
}
