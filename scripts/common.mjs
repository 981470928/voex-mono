import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const LOCAL = path.join(ROOT, '.voex');
export const CONFIG = path.join(ROOT, 'voex.config.json');
export const EXAMPLE = path.join(ROOT, 'voex.config.example.json');
export const PREBUILT = path.join(ROOT, 'prebuilt');
export const RUNTIME = path.join(LOCAL, 'runtime');
export const ENV_FILE = path.join(RUNTIME, 'server.env');
export const STATE = path.join(RUNTIME, 'state.json');
export const BINARY = process.platform === 'win32' ? 'voex-server.exe' : 'voex-server';
export const TARGET = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`;

export const digest = value => createHash('sha256').update(value).digest('hex');
export const exists = async file => fs.access(file).then(() => true, () => false);

/** Windows, Linux and macOS on x64/arm64 are supported by the bundled scripts. */
export function runtimeCheck() {
  if (!['win32', 'linux', 'darwin'].includes(process.platform)) throw new Error('仅支持 Windows、Linux 和 macOS。');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major === 22 && minor >= 18 || major === 24 && minor >= 12 || major > 24))
    throw new Error('需要 Node.js 22.18+（22.x）或 24.12+。');
  if (!['x64', 'arm64'].includes(process.arch)) throw new Error('目前支持 x64 和 arm64。');
}

function text(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || /[\x00-\x1f\x7f]/.test(value))
    throw new Error(`${label} 必须是${allowEmpty ? '' : '非空'}单行文本。`);
  return value;
}
function hostname(value, label) {
  text(value, label);
  if (!net.isIP(value) && (!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value) || value.includes('..')))
    throw new Error(`${label} 需要主机名或 IP，不能包含协议或端口。`);
  return value;
}
function portNumber(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${label} 必须是 1–65535 的整数。`);
  return value;
}

export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('配置需要 JSON 对象。');
  const db = raw.database;
  if (!db || typeof db !== 'object') throw new Error('缺少 database 配置。');
  const result = {
    host: hostname(raw.host ?? '127.0.0.1', 'host'),
    port: portNumber(raw.port ?? 8080, 'port'),
    database: {
      host: hostname(db.host, 'database.host'),
      port: portNumber(db.port ?? 3306, 'database.port'),
      user: text(db.user, 'database.user'),
      password: text(db.password ?? '', 'database.password', true),
      name: text(db.name, 'database.name'),
    },
    pexelsKey: text(raw.pexelsKey ?? '', 'pexelsKey', true).trim(),
    collaboration: raw.collaboration ?? false,
    collaborationPort: portNumber(raw.collaborationPort ?? 8091, 'collaborationPort'),
  };
  if (typeof result.collaboration !== 'boolean') throw new Error('collaboration 必须是 true 或 false。');
  if (result.collaboration && result.port === result.collaborationPort)
    throw new Error('HTTP 与协同端口不能相同。');
  return result;
}

export async function loadConfig() {
  if (!(await exists(CONFIG)))
    throw new Error('缺少 voex.config.json。请先复制 voex.config.example.json 并填写，或运行 node scripts/setup.mjs。');
  try {
    return normalize(JSON.parse(await fs.readFile(CONFIG, 'utf8')));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('voex.config.json 不是有效 JSON，请检查引号和逗号。');
    throw error;
  }
}

export async function writeConfig(config) {
  await fs.writeFile(CONFIG, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

function loopback(config) {
  if (config.host === '0.0.0.0') return '127.0.0.1';
  if (config.host === '::') return '::1';
  return config.host;
}

/** Loopback http origin for the configured listen address. */
export function origin(config, port = config.port) {
  return `http://${net.isIP(loopback(config)) === 6 ? `[${loopback(config)}]` : loopback(config)}:${port}`;
}

/** Spawn wrapper that handles Windows command shims. */
export function command(name, args, options = {}) {
  const windowsShim = process.platform === 'win32' && (name === 'pnpm' || name === 'corepack');
  if (windowsShim) {
    if (!args.every(arg => /^[a-zA-Z0-9._=:/@-]+$/.test(arg))) throw new Error('Invalid fixed pnpm command');
    return spawn(`${name} ${args.join(' ')}`, { ...options, shell: true, windowsHide: true });
  }
  return spawn(name, args, { ...options, windowsHide: true });
}
export async function exec(name, args, options = {}) {
  const child = command(name, args, { stdio: 'inherit', ...options });
  await new Promise((resolve, reject) => {
    child.once('error', error => reject(new Error(`无法执行 ${name}：${error.code ?? error.message}`)));
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`${name} 执行失败（${code ?? 'signal'}）。`))));
  });
}
function probe(name, args) {
  const win = process.platform === 'win32' && (name === 'pnpm' || name === 'corepack');
  return spawnSync(win ? `${name} ${args.join(' ')}` : name, win ? [] : args, {
    encoding: 'utf8',
    shell: win,
    windowsHide: true,
  });
}
export function requireGo() {
  const result = probe('go', ['version']);
  if (result.error || result.status !== 0)
    throw new Error('未找到可用的 Go，请安装并加入 PATH；快速部署使用 prebuilt/ 不需要 Go。');
  console.log(`go: ${result.stdout.trim()}`);
}
export function pnpmRunner() {
  const direct = probe('pnpm', ['--version']);
  if (!direct.error && direct.status === 0) return { command: 'pnpm', prefix: [], version: direct.stdout.trim() };
  const corepack = probe('corepack', ['pnpm', '--version']);
  if (!corepack.error && corepack.status === 0)
    return { command: 'corepack', prefix: ['pnpm'], version: corepack.stdout.trim() };
  throw new Error('未找到 pnpm。请安装 pnpm，或通过 Node.js 自带的 corepack 执行 corepack enable pnpm。');
}
export async function execPnpm(args, options = {}) {
  const runner = pnpmRunner();
  await exec(runner.command, [...runner.prefix, ...args], options);
}
export const pnpmVersion = () => pnpmRunner().version;

export async function available(host, number) {
  await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', error => reject(new Error(`端口 ${host}:${number} 无法使用（${error.code}）。`)));
    listener.listen({ host, port: number, exclusive: true }, () => listener.close(resolve));
  });
}
export async function databaseReachable(config) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.database.host, port: config.database.port });
    const done = error => {
      socket.destroy();
      error ? reject(error) : resolve();
    };
    socket.setTimeout(10000, () => done(new Error('数据库连接超时，请检查地址、端口和网络。')));
    socket.once('error', error => done(new Error(`数据库端口不可达（${error.code}），请检查地址和端口。`)));
    socket.once('connect', () => done());
  });
}

export async function atomicJSON(file, value) {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, file);
}

export function runtimeEnv(config, extras = {}) {
  const secrets = path.join(LOCAL, 'secrets');
  const env = {
    MYSQL_HOST: config.database.host,
    MYSQL_PORT: String(config.database.port),
    MYSQL_USER: config.database.user,
    MYSQL_PASSWORD: config.database.password,
    MYSQL_DATABASE: config.database.name,
    VOEX_ADDR: `${net.isIP(config.host) === 6 ? `[${config.host}]` : config.host}:${config.port}`,
    VOEX_STORAGE_ROOT: path.join(LOCAL, 'data'),
    JWT_SECRET_FILE: path.join(secrets, 'jwt-key'),
    SHARE_SECRET_FILE: path.join(secrets, 'share-key'),
    VOEX_COLLAB_SECRET_FILE: path.join(secrets, 'collab-key'),
    VOEX_HTTP_READ_TIMEOUT: '2m',
    VOEX_COLLAB_ENABLED: String(config.collaboration),
    VOEX_COLLAB_URL: `http://127.0.0.1:${config.collaborationPort}`,
    VOEX_COLLAB_WS_URL: '/api/collab/ws',
    PEXELS_API_KEY: config.pexelsKey,
    VOEX_ENV_FILE: ENV_FILE,
  };
  for (const [key, value] of Object.entries(extras)) if (value !== undefined) env[key] = value;
  return env;
}

export async function ensureSecrets() {
  const directory = path.join(LOCAL, 'secrets');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(LOCAL, 'data'), { recursive: true, mode: 0o700 });
  const initialized = await exists(STATE);
  for (const name of ['jwt-key', 'share-key', 'collab-key']) {
    const file = path.join(directory, name);
    if (!(await exists(file))) {
      if (initialized)
        throw new Error(`签名密钥 ${name} 缺失，请从备份恢复，避免已有会话和分享失效。`);
      await fs.writeFile(file, randomBytes(64).toString('hex'), { mode: 0o600, flag: 'wx' });
    }
    if ((await fs.readFile(file)).length < 64) throw new Error(`签名密钥 ${name} 长度不足，请检查原文件。`);
  }
}

/** Validate config, create secrets, persist the generated env file, and return it. */
export async function prepareRuntime(config, extras = {}) {
  await fs.mkdir(RUNTIME, { recursive: true, mode: 0o700 });
  await ensureSecrets();
  const env = runtimeEnv(config, extras);
  const content = Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
  const temporary = `${ENV_FILE}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, ENV_FILE);
  await atomicJSON(STATE, { version: 1, createdAt: new Date().toISOString() });
  return env;
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

const MATHJAX = [
  ['tex-svg.js', 'es5/tex-svg.js', 'd4295dc33744836935c1399feece5159577b34c5c8ffb9f1c6324cd82e03a882'],
  ['mathjax-LICENSE.txt', 'LICENSE', 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'],
];

/** Provide the fixed MathJax bundle through Vite's public directory. */
export async function ensureVendor() {
  const cache = path.join(LOCAL, 'cache');
  const target = path.join(ROOT, 'web', 'public', 'vendor');
  await fs.mkdir(cache, { recursive: true });
  await fs.mkdir(target, { recursive: true });
  for (const [filename, remote, sha] of MATHJAX) {
    const cached = path.join(cache, `mathjax-3.2.2-${filename}`);
    let data = (await exists(cached)) ? await fs.readFile(cached) : null;
    if (!data || digest(data) !== sha) {
      const bundled = path.join(PREBUILT, 'web', 'vendor', filename);
      const copy = (await exists(bundled)) ? await fs.readFile(bundled) : null;
      if (copy && digest(copy) === sha) data = copy;
    }
    if (!data || digest(data) !== sha) {
      console.log(`下载固定版本 MathJax 3.2.2 ${filename} 并校验摘要…`);
      const response = await fetch(`https://cdn.jsdelivr.net/npm/mathjax@3.2.2/${remote}`, {
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(`公式资源下载失败（HTTP ${response.status}）。`);
      data = Buffer.from(await response.arrayBuffer());
      if (digest(data) !== sha) throw new Error('公式资源摘要不匹配，已停止。');
      await fs.writeFile(cached, data);
    }
    await fs.writeFile(path.join(target, filename), data);
  }
}

export function fail(error) {
  console.error(`\n错误：${error.message}`);
  process.exitCode = 1;
}
