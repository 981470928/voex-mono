import { promises as fs } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  CONFIG, EXAMPLE, exists, loadConfig, normalize, writeConfig, runtimeCheck,
  databaseReachable, prepareRuntime, ENV_FILE, fail,
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
  } finally {
    rl.close();
  }
}

/** Load voex.config.json; when it is missing, create it interactively. */
export async function ensureConfig() {
  if (await exists(CONFIG)) {
    const config = await loadConfig();
    if (process.platform !== 'win32') await fs.chmod(CONFIG, 0o600).catch(() => {});
    return config;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      '缺少 voex.config.json。请复制 voex.config.example.json 为 voex.config.json 并填写数据库，或在交互终端中重新执行。'
    );
  if (!(await exists(EXAMPLE))) throw new Error('缺少 voex.config.example.json，无法生成配置。');
  console.log('未找到 voex.config.json，开始首次配置。密码和 Key 输入时不显示；留空采用默认值。');
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
  }
  const config = normalize(result);
  await writeConfig(config);
  console.log('已写入 voex.config.json（已被 Git 忽略）。');
  return config;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      [
        'node scripts/setup.mjs [--check]',
        '读取 voex.config.json，校验配置和数据库，并写入运行配置（.voex/runtime/server.env）。',
        '缺少配置文件时会交互生成；生成的运行配置同时供本地启动和快速部署使用。',
        '--check：只校验，不写入运行配置。',
      ].join('\n')
    );
    return;
  }
  if (args.some(arg => arg !== '--check')) throw new Error('未知参数，请使用 --help。');
  runtimeCheck();
  const config = await ensureConfig();
  await databaseReachable(config);
  if (args.includes('--check')) {
    console.log('配置校验通过，数据库端口可达。');
    return;
  }
  const env = await prepareRuntime(config);
  console.log(`已生成运行配置：${path.relative(process.cwd(), ENV_FILE)}`);
  console.log(`数据库：${config.database.user}@${config.database.host}:${config.database.port}/${config.database.name}`);
  console.log(`HTTP 端口：${config.port}`);
  console.log('下一步：本地源码启动运行 node scripts/dev.mjs；快速部署运行 node scripts/start.mjs。');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(fail);
