import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT, LOCAL, BINARY, exists, runtimeCheck, requireGo, loadConfig,
  databaseReachable, prepareRuntime, ensureVendor, exec, execPnpm,
  origin, available, fail,
} from './common.mjs';
import { runServices } from './services.mjs';

const WEB = path.join(ROOT, 'web');
const COLLAB = path.join(ROOT, 'server/collab');
const BUILD = path.join(LOCAL, 'build');

async function treeChanged(lock, marker) {
  if (!(await exists(marker))) return true;
  try {
    const [lockInfo, markerInfo] = await Promise.all([fs.stat(lock), fs.stat(marker)]);
    return lockInfo.mtimeMs > markerInfo.mtimeMs;
  } catch {
    return true;
  }
}

async function installDependencies(config) {
  if (await treeChanged(path.join(WEB, 'pnpm-lock.yaml'), path.join(WEB, 'node_modules/.modules.yaml'))) {
    console.log('安装前端锁定版本依赖…');
    await execPnpm(['install', '--frozen-lockfile'], { cwd: WEB, env: { ...process.env, CI: 'true' } });
  }
  if (config.collaboration && (await treeChanged(path.join(COLLAB, 'pnpm-lock.yaml'), path.join(COLLAB, 'node_modules/.modules.yaml')))) {
    console.log('安装协同服务锁定版本依赖…');
    await execPnpm(['install', '--frozen-lockfile'], { cwd: COLLAB, env: { ...process.env, CI: 'true' } });
  }
}

export async function startDev({ check = false } = {}) {
  runtimeCheck();
  requireGo();
  const config = await loadConfig();
  await databaseReachable(config);
  await installDependencies(config);
  await ensureVendor();
  const devPort = Number(process.env.VOEX_DEV_PORT || 3500);
  if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535)
    throw new Error('VOEX_DEV_PORT 必须是 1–65535 的整数。');
  if (devPort === config.port) throw new Error('本地前端端口与 HTTP 端口不能相同。');
  await available(config.host, devPort);

  const env = await prepareRuntime(config, { VOEX_WEB_ROOT: '' });
  await fs.mkdir(BUILD, { recursive: true, mode: 0o700 });
  const binary = path.join(BUILD, BINARY);
  console.log('编译本地 Go API…');
  await exec('go', ['build', '-mod=readonly', '-trimpath', '-o', binary, './cmd/voex-server'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, CGO_ENABLED: '0', GOCACHE: path.join(LOCAL, 'cache', 'go-build') },
  });
  await exec(binary, ['check-config'], { cwd: ROOT, env: { ...process.env, ...env } });
  if (check) {
    console.log('本地环境、数据库及 Go API 检查通过，未启动服务。');
    return;
  }

  let collab = null;
  if (config.collaboration) {
    console.log('构建多人协同服务…');
    await fs.rm(path.join(COLLAB, 'dist'), { recursive: true, force: true });
    await exec(process.execPath, [path.join(COLLAB, 'build.mjs')], {
      cwd: COLLAB,
      env: { ...process.env, VOEX_COLLAB_SCHEMA_SOURCE: path.join(WEB, 'packages/editor-schema/src/index.ts') },
    });
    collab = {
      file: process.execPath,
      args: [path.join(COLLAB, 'dist/server.js')],
      cwd: COLLAB,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        VOEX_COLLAB_HOST: '127.0.0.1',
        VOEX_COLLAB_PORT: String(config.collaborationPort),
        VOEX_COLLAB_API_URL: origin(config),
        VOEX_COLLAB_SECRET_FILE: env.VOEX_COLLAB_SECRET_FILE,
        VOEX_COLLAB_ORIGINS: [config.publicUrl, origin(config, devPort)].filter(Boolean).join(','),
      },
    };
  }

  const vite = path.join(WEB, 'node_modules/vite/bin/vite.js');
  if (!(await exists(vite))) throw new Error('未找到 Vite，请重新执行本命令以安装前端依赖。');
  const webOrigin = origin(config, devPort);
  await runServices({
    config,
    env,
    api: { file: binary, args: ['serve'], cwd: ROOT },
    collab,
    extras: [
      {
        label: 'Vite 前端',
        file: process.execPath,
        args: [vite, '--host', config.host, '--port', String(devPort), '--strictPort'],
        cwd: WEB,
        env: {
          ...process.env,
          VITE_API_PROXY_TARGET: origin(config),
          VITE_COLLAB_PROXY_TARGET: `ws://127.0.0.1:${config.collaborationPort}`,
        },
      },
    ],
    ready: [
      { label: 'Go API', url: `${origin(config)}/api/health/ready` },
      { label: 'Vite 前端', url: `${webOrigin}/app/` },
    ],
    banner: `Voex 本地开发已启动：${webOrigin}/app/\n前端热更新由 Vite 提供，API 监听 ${origin(config)}。`,
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      [
        'node scripts/dev.mjs [--check]',
        '本地源码启动：校验 Node/Go/pnpm/MySQL，安装依赖、编译 Go API，并一键启动 Vite 前端与 Go API。',
        '使用前先复制并填写 voex.config.json（或运行 node scripts/setup.mjs）。',
        '默认访问 http://127.0.0.1:3500/app/；VOEX_DEV_PORT 可修改前端端口。',
        '--check：只安装/编译/校验，不启动服务。',
      ].join('\n')
    );
  } else if (args.some(arg => arg !== '--check')) fail(new Error('未知参数，请使用 --help。'));
  else startDev({ check: args.includes('--check') }).catch(fail);
}
