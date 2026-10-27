import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzip as gunzipBuffer } from 'node:zlib';
import { promisify } from 'node:util';
import {
  ROOT, LOCAL, PREBUILT, BINARY, TARGET, exists, runtimeCheck,
  databaseReachable, prepareRuntime, filesDigest, digest, exec, origin, collaborationOrigins, fail,
} from './common.mjs';
import { runServices } from './services.mjs';
import { ensureConfig as configure } from './setup.mjs';

const gunzip = promisify(gunzipBuffer);
const MANIFEST = path.join(PREBUILT, 'MANIFEST.json');

async function readManifest() {
  if (!(await exists(MANIFEST)))
    throw new Error('未找到 prebuilt/MANIFEST.json，该副本没有预置产物。请使用 node scripts/dev.mjs 从源码启动，或运行 node scripts/package.mjs 生成预置包。');
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
  } catch {
    throw new Error('prebuilt/MANIFEST.json 已损坏，请重新运行 node scripts/package.mjs。');
  }
  if (manifest.format !== 1 || !manifest.server || !manifest.web)
    throw new Error('prebuilt 清单格式不受支持，请重新运行 node scripts/package.mjs。');
  return manifest;
}

async function verifyDirectory(name, expected) {
  const directory = path.join(PREBUILT, name);
  if (!(await exists(directory))) throw new Error(`预置产物缺少 prebuilt/${name}，请重新运行 node scripts/package.mjs。`);
  console.log(`校验预置 ${name}…`);
  const actual = await filesDigest(directory);
  if (actual !== expected) throw new Error(`prebuilt/${name} 内容与清单不一致，请重新运行 node scripts/package.mjs。`);
}

async function extractServer(entry) {
  const directory = path.join(LOCAL, 'prebuilt', TARGET);
  const target = path.join(directory, BINARY);
  const marker = path.join(directory, 'source.json');
  if (await exists(target)) {
    try {
      const state = JSON.parse(await fs.readFile(marker, 'utf8'));
      if (state.sha256 === entry.sha256 && digest(await fs.readFile(target)) === entry.binarySha256) return target;
    } catch {}
  }
  const archive = path.join(PREBUILT, entry.path);
  if (!(await exists(archive))) throw new Error(`预置产物缺少 ${entry.path}，请重新运行 node scripts/package.mjs。`);
  const compressed = await fs.readFile(archive);
  if (digest(compressed) !== entry.sha256) throw new Error(`${entry.path} 摘要不匹配，请重新运行 node scripts/package.mjs。`);
  console.log(`解压 ${TARGET} Go 服务…`);
  const binary = await gunzip(compressed);
  if (digest(binary) !== entry.binarySha256) throw new Error(`${entry.path} 解压后的摘要不匹配。`);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, binary, { mode: 0o755 });
  await fs.rm(target, { force: true });
  await fs.rename(temporary, target);
  await fs.writeFile(marker, JSON.stringify({ sha256: entry.sha256, binarySha256: entry.binarySha256 }) + '\n', { mode: 0o600 });
  return target;
}

export async function startPrebuilt({ check = false } = {}) {
  runtimeCheck();
  const config = await configure();
  const manifest = await readManifest();
  const entry = manifest.server[TARGET];
  if (!entry)
    throw new Error(
      `预置产物不支持当前平台 ${TARGET}。请使用 node scripts/dev.mjs 从源码启动，或在有 Go 的机器上运行 node scripts/package.mjs 重新打包。`
    );
  await verifyDirectory('web', manifest.web.digest);
  if (config.collaboration) {
    if (!manifest.collab) throw new Error('该预置包未包含多人协同服务，请重新运行 node scripts/package.mjs。');
    await verifyDirectory('collab', manifest.collab.digest);
  }
  const webRoot = path.join(PREBUILT, 'web');
  const binary = await extractServer(entry);
  await databaseReachable(config);
  const env = await prepareRuntime(config, { VOEX_WEB_ROOT: webRoot });
  await exec(binary, [check ? 'check-config' : 'init-db'], { cwd: ROOT, env: { ...process.env, ...env } });
  if (check) {
    console.log('预置产物、配置、数据库及运行环境检查通过，未启动服务。');
    return;
  }

  let collab = null;
  if (config.collaboration) {
    collab = {
      file: process.execPath,
      args: [path.join(PREBUILT, 'collab/server.js')],
      cwd: path.join(PREBUILT, 'collab'),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        VOEX_COLLAB_HOST: '127.0.0.1',
        VOEX_COLLAB_PORT: String(config.collaborationPort),
        VOEX_COLLAB_API_URL: origin(config),
        VOEX_COLLAB_SECRET_FILE: env.VOEX_COLLAB_SECRET_FILE,
        VOEX_COLLAB_ORIGINS: collaborationOrigins(config.publicUrl),
      },
    };
  }

  const appOrigin = origin(config);
  await runServices({
    config,
    env,
    api: { file: binary, args: ['serve'], cwd: ROOT },
    collab,
    ready: [
      { label: 'Go API', url: `${appOrigin}/api/health/ready` },
      ...(config.collaboration ? [{ label: '协同服务', url: `http://127.0.0.1:${config.collaborationPort}/health/ready` }] : []),
    ],
    banner: `Voex 已启动：${appOrigin}/app/`,
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      [
        'node scripts/start.mjs [--check]',
        '快速部署：直接使用仓库内 prebuilt/ 的前后端产物启动，无需 Go 或 pnpm。',
        '运行前只需填写 voex.config.json。',
        '--check：只校验预置产物、配置和数据库，不启动服务。',
      ].join('\n')
    );
  } else if (args.some(arg => arg !== '--check')) fail(new Error('未知参数，请使用 --help。'));
  else startPrebuilt({ check: args.includes('--check') }).catch(fail);
}
