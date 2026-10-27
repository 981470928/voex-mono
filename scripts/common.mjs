import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const LOCAL = path.join(ROOT, '.voex');
export const CONFIG = path.join(ROOT, 'voex.config.json');
export const ACTIVE = path.join(LOCAL, 'active.json');
export const binaryName = process.platform === 'win32' ? 'voex-server.exe' : 'voex-server';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const exists = async file => fs.access(file).then(() => true, () => false);
export const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export function runtimeCheck() {
  if (!['win32', 'linux'].includes(process.platform)) throw new Error('仅支持 Windows 和 Linux。');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major === 22 && minor >= 18 || major === 24 && minor >= 12 || major > 24))
    throw new Error('需要 Node.js 22.18+（22.x）或 24.12+。');
  if (!['x64', 'arm64'].includes(process.arch)) throw new Error('目前支持 x64 和 arm64。');
}
function text(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || !allowEmpty && !value.trim() || /[\x00-\x1f\x7f]/.test(value))
    throw new Error(`${label} 必须是${allowEmpty ? '' : '非空'}单行文本。`);
  return value;
}
function host(value, label) {
  text(value, label);
  if (!net.isIP(value) && (!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value) || value.includes('..')))
    throw new Error(`${label} 需要主机名或 IP，不能包含协议或端口。`);
  return value;
}
function port(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${label} 必须是 1–65535 的整数。`);
  return value;
}
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('配置需要 JSON 对象。');
  const db = raw.database;
  if (!db || typeof db !== 'object') throw new Error('缺少 database 配置。');
  const result = {
    host: host(raw.host ?? '127.0.0.1', 'host'),
    port: port(raw.port ?? 8080, 'port'),
    database: {
      host: host(db.host, 'database.host'), port: port(db.port ?? 3306, 'database.port'),
      user: text(db.user, 'database.user'), password: text(db.password ?? '', 'database.password', true),
      name: text(db.name, 'database.name'),
    },
    pexelsKey: text(raw.pexelsKey ?? '', 'pexelsKey', true).trim(),
    collaboration: raw.collaboration ?? false,
    collaborationPort: port(raw.collaborationPort ?? 8091, 'collaborationPort'),
    publicUrl: raw.publicUrl ?? '',
  };
  if (typeof result.collaboration !== 'boolean') throw new Error('collaboration 必须是 true 或 false。');
  if (result.collaboration && result.port === result.collaborationPort) throw new Error('HTTP 与协同端口不能相同。');
  if (result.collaboration) {
    let url;
    try { url = new URL(result.publicUrl); } catch { throw new Error('启用协同时必须填写 publicUrl，例如 http://localhost:8080。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error('publicUrl 只允许 http(s) 的域名和端口，不包含路径、凭据或参数。');
    result.publicUrl = url.origin;
  } else result.publicUrl = '';
  return result;
}
export async function loadConfig() {
  if (!await exists(CONFIG)) throw new Error('缺少 voex.config.json。请先运行 node scripts/init.mjs，或复制 voex.config.example.json 后填写。');
  try { return normalize(await readJSON(CONFIG)); }
  catch (error) { if (error instanceof SyntaxError) throw new Error('voex.config.json 不是有效 JSON，请检查引号和逗号。'); throw error; }
}
export const fingerprint = config => digest(JSON.stringify(config));
export function command(name, args, options = {}) {
  if (process.platform === 'win32' && name === 'pnpm') {
    if (!args.every(arg => /^[a-zA-Z0-9._=:/@-]+$/.test(arg))) throw new Error('Invalid fixed pnpm command');
    return spawn(`pnpm ${args.join(' ')}`, { ...options, shell: true, windowsHide: true });
  }
  return spawn(name, args, { ...options, windowsHide: true });
}
export async function exec(name, args, options = {}) {
  const child = command(name, args, { stdio: 'inherit', ...options });
  await new Promise((resolve, reject) => {
    child.once('error', error => reject(new Error(`无法执行 ${name}：${error.code ?? error.message}`)));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${name} 执行失败（${code ?? 'signal'}）。`)));
  });
}
export function buildTools() {
  for (const name of ['go', 'pnpm']) {
    const args = name === 'go' ? ['version'] : ['--version'];
    const win = process.platform === 'win32' && name === 'pnpm';
    const result = spawnSync(win ? 'pnpm --version' : name, win ? [] : args, { encoding: 'utf8', shell: win, windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`未找到可用的 ${name}，请安装并加入 PATH。运行已打包版本不需要该工具。`);
    console.log(`${name}: ${result.stdout.trim()}`);
  }
}
export async function available(hostname, number) {
  await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', error => reject(new Error(`端口 ${hostname}:${number} 无法使用（${error.code}）。`)));
    listener.listen({ host: hostname, port: number, exclusive: true }, () => listener.close(resolve));
  });
}
export async function databaseReachable(config) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.database.host, port: config.database.port });
    const done = error => { socket.destroy(); error ? reject(error) : resolve(); };
    socket.setTimeout(10000, () => done(new Error('数据库连接超时，请检查地址、端口和网络。')));
    socket.once('error', error => done(new Error(`数据库端口不可达（${error.code}），请检查地址和端口。`)));
    socket.once('connect', () => done());
  });
}
export async function checkPexels(config) {
  if (!config.pexelsKey) { console.log('Pexels 未配置，图库功能不可用；其他功能可正常运行。'); return; }
  let response;
  try { response = await fetch('https://api.pexels.com/v1/curated?per_page=1', { headers: { Authorization: config.pexelsKey }, signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('无法访问 Pexels，请检查网络或清空 pexelsKey 以禁用图库。'); }
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Pexels Key 校验失败（HTTP ${response.status}）。`);
  console.log('Pexels Key 校验通过。');
}
export async function atomicJSON(file, value) {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, file);
}
export function runtimeEnv(config, release) {
  const bracket = value => net.isIP(value) === 6 ? `[${value}]` : value;
  const secrets = path.join(LOCAL, 'secrets');
  return {
    MYSQL_HOST: config.database.host, MYSQL_PORT: String(config.database.port), MYSQL_USER: config.database.user,
    MYSQL_PASSWORD: config.database.password, MYSQL_DATABASE: config.database.name,
    VOEX_ADDR: `${bracket(config.host)}:${config.port}`, VOEX_STORAGE_ROOT: path.join(LOCAL, 'data'),
    JWT_SECRET_FILE: path.join(secrets, 'jwt-key'), SHARE_SECRET_FILE: path.join(secrets, 'share-key'),
    VOEX_COLLAB_SECRET_FILE: path.join(secrets, 'collab-key'), VOEX_HTTP_READ_TIMEOUT: '2m',
    VOEX_COLLAB_ENABLED: String(config.collaboration), VOEX_COLLAB_URL: `http://127.0.0.1:${config.collaborationPort}`,
    VOEX_COLLAB_WS_URL: '/api/collab/ws', VOEX_WEB_ROOT: path.join(release, 'web'),
    VOEX_ENV_FILE: path.join(release, 'server.env'),
  };
}
export async function ensureSecrets() {
  const directory = path.join(LOCAL, 'secrets');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(LOCAL, 'data'), { recursive: true, mode: 0o700 });
  const initialized = await exists(ACTIVE);
  for (const name of ['jwt-key', 'share-key', 'collab-key']) {
    const file = path.join(directory, name);
    if (!await exists(file)) {
      if (initialized) throw new Error(`签名密钥 ${name} 缺失，请从备份恢复，避免已有会话和分享失效。`);
      await fs.writeFile(file, randomBytes(64).toString('hex'), { mode: 0o600, flag: 'wx' });
    }
    if ((await fs.readFile(file)).length < 64) throw new Error(`签名密钥 ${name} 长度不足，请检查原文件。`);
  }
}
export async function filesDigest(directory) {
  const entries = [];
  async function visit(dir) {
    for (const item of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink()) throw new Error('构建目录不能包含符号链接。');
      if (item.isDirectory()) await visit(file);
      else if (item.isFile()) entries.push([path.relative(directory, file).split(path.sep).join('/'), digest(await fs.readFile(file))]);
    }
  }
  await visit(directory);
  return digest(JSON.stringify(entries));
}
export async function artifactInfo(release) {
  if (!await exists(path.join(release, 'web/index.html'))) throw new Error('前端构建产物缺失。');
  return { binary: digest(await fs.readFile(path.join(release, binaryName))), web: await filesDigest(path.join(release, 'web')) };
}
export function fail(error) {
  console.error(`\n错误：${error.message}`);
  process.exitCode = 1;
}
