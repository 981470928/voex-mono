import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { gzip as gzipBuffer } from 'node:zlib';
import {
  ROOT, LOCAL, PREBUILT, exists, runtimeCheck, requireGo, exec, execPnpm,
  pnpmVersion, ensureVendor, filesDigest, digest, fail,
} from './common.mjs';

const gzip = promisify(gzipBuffer);
const WEB = path.join(ROOT, 'web');
const COLLAB = path.join(ROOT, 'server/collab');
const TARGETS = [
  ['linux', 'amd64'],
  ['linux', 'arm64'],
  ['windows', 'amd64'],
  ['windows', 'arm64'],
];

async function fresh(lock, marker) {
  if (!(await exists(marker))) return false;
  try {
    const [lockInfo, markerInfo] = await Promise.all([fs.stat(lock), fs.stat(marker)]);
    return lockInfo.mtimeMs <= markerInfo.mtimeMs;
  } catch {
    return false;
  }
}

async function buildWeb(target) {
  console.log('构建预置前端…');
  await exec(process.execPath, [path.join(ROOT, 'scripts/build-web.mjs')], {
    cwd: WEB,
    env: {
      ...process.env,
      VOEX_BUILD_WEB_ROOT: target,
      NODE_OPTIONS: '--max-old-space-size=1024',
    },
  });
}

async function buildServers(serverDirectory) {
  const entries = {};
  for (const [goos, goarch] of TARGETS) {
    const key = `${goos}-${goarch}`;
    const name = goos === 'windows' ? 'voex-server.exe' : 'voex-server';
    const binary = path.join(serverDirectory, `${name}-${key}`);
    console.log(`构建 ${key} Go 服务…`);
    await exec(
      'go',
      ['build', '-mod=readonly', '-trimpath', '-ldflags=-s -w', '-o', binary, './cmd/voex-server'],
      {
        cwd: path.join(ROOT, 'server'),
        env: {
          ...process.env,
          GOOS: goos,
          GOARCH: goarch,
          CGO_ENABLED: '0',
          GOCACHE: path.join(LOCAL, 'cache', 'go-build'),
        },
      }
    );
    const data = await fs.readFile(binary);
    const compressed = await gzip(data, { level: 9 });
    const archiveName = `voex-server-${key}.gz`;
    await fs.writeFile(path.join(serverDirectory, archiveName), compressed);
    await fs.rm(binary);
    entries[key] = {
      path: `server/${archiveName}`,
      sha256: digest(compressed),
      binarySha256: digest(data),
      size: compressed.length,
    };
    console.log(`  ${key}: ${(data.length / 1024 / 1024).toFixed(1)} MiB → ${(compressed.length / 1024 / 1024).toFixed(1)} MiB`);
  }
  return entries;
}

async function buildCollaboration(target) {
  if (!(await fresh(path.join(COLLAB, 'pnpm-lock.yaml'), path.join(COLLAB, 'node_modules/.modules.yaml')))) {
    console.log('安装协同服务锁定版本依赖…');
    await execPnpm(['install', '--frozen-lockfile'], { cwd: COLLAB, env: { ...process.env, CI: 'true' } });
  }
  console.log('构建多人协同服务…');
  await fs.rm(path.join(COLLAB, 'dist'), { recursive: true, force: true });
  await exec(process.execPath, [path.join(COLLAB, 'build.mjs')], {
    cwd: COLLAB,
    env: { ...process.env, VOEX_COLLAB_SCHEMA_SOURCE: path.join(WEB, 'packages/editor-schema/src/index.ts') },
  });
  await fs.cp(path.join(COLLAB, 'dist'), target, { recursive: true });
  await fs.writeFile(path.join(target, 'package.json'), '{"type":"module","private":true}\n');
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(
      [
        'node scripts/package.mjs',
        '维护者命令：重新构建 prebuilt/（前端、Windows/Linux x64/arm64 Go 服务、协同服务）并写入 MANIFEST.json。',
        '需要 Node.js、pnpm 和 Go；产物提交到 Git 后，用户可只填写配置并用 node scripts/start.mjs 启动。',
      ].join('\n')
    );
    return;
  }
  if (process.argv.length > 2) throw new Error('未知参数，请使用 --help。');
  runtimeCheck();
  requireGo();
  pnpmVersion();
  if (!(await fresh(path.join(WEB, 'pnpm-lock.yaml'), path.join(WEB, 'node_modules/.modules.yaml')))) {
    console.log('安装前端锁定版本依赖…');
    await execPnpm(['install', '--frozen-lockfile'], { cwd: WEB, env: { ...process.env, CI: 'true' } });
  }
  await ensureVendor();

  const staging = path.join(LOCAL, `package-${Date.now()}`);
  await fs.mkdir(staging, { recursive: true, mode: 0o700 });
  const webDirectory = path.join(staging, 'web');
  const serverDirectory = path.join(staging, 'server');
  const collabDirectory = path.join(staging, 'collab');
  await fs.mkdir(serverDirectory, { recursive: true });
  await buildWeb(webDirectory);
  const server = await buildServers(serverDirectory);
  await buildCollaboration(collabDirectory);

  const manifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    platforms: Object.keys(server),
    web: { digest: await filesDigest(webDirectory) },
    collab: { digest: await filesDigest(collabDirectory) },
    server,
  };
  await fs.writeFile(path.join(staging, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');

  const backup = `${PREBUILT}.old`;
  await fs.rm(backup, { recursive: true, force: true });
  if (await exists(PREBUILT)) await fs.rename(PREBUILT, backup);
  try {
    await fs.rename(staging, PREBUILT);
  } catch (error) {
    if (await exists(backup)) await fs.rename(backup, PREBUILT);
    throw error;
  }
  await fs.rm(backup, { recursive: true, force: true });
  if (process.platform !== 'win32') await fs.chmod(PREBUILT, 0o755).catch(() => {});
  console.log(`\n预置包已更新：${path.relative(process.cwd(), PREBUILT)}/`);
  console.log(`平台：${manifest.platforms.join('、')}`);
  console.log('提交 prebuilt/ 后，用户只需填写 voex.config.json 并运行 node scripts/start.mjs。');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(fail);
