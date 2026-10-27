/** 启动配置集中读取；密钥只用于 Go 与协同进程之间的内部请求。 */
import { readFileSync } from 'node:fs';

export const VERSION = '1.0.0';
export const MAX_STATE = 16 * 1024 * 1024;
export const MAX_MESSAGE = 20 * 1024 * 1024;

export function loadConfig() {
  const host = process.env.VOEX_COLLAB_HOST || '127.0.0.1';
  const port = Number(process.env.VOEX_COLLAB_PORT || 8091);
  const api = (process.env.VOEX_COLLAB_API_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
  const secretPath = process.env.VOEX_COLLAB_SECRET_FILE;
  if (!secretPath) throw new Error('VOEX_COLLAB_SECRET_FILE is required');
  const secret = readFileSync(secretPath, 'utf8').trim();
  if (Buffer.byteLength(secret) < 32)
    throw new Error('Collaboration secret must contain at least 32 bytes');
  const origins = new Set(
    (process.env.VOEX_COLLAB_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  if (!origins.size)
    throw new Error('VOEX_COLLAB_ORIGINS must explicitly allow the web application origins');
  for (const origin of origins)
    if (new URL(origin).origin !== origin)
      throw new Error('Origins must be exact origins without a path');
  return { host, port, api, secret, origins };
}

export type CollaborationConfig = ReturnType<typeof loadConfig>;
