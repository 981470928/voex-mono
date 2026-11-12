import { Messages, ServiceError, SocketCloseCode, httpStatus, messageForStatus, sizeLimitMessage } from "./errors.js";
export { ServiceError } from "./errors.js";
import * as Y from 'yjs';
import { SCHEMA_VERSION } from '@voex/editor-schema';
import { MAX_STATE, type CollaborationConfig } from './config.js';
import type { Room } from './types.js';

export const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
export function decode(value: string, max = MAX_STATE) {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(max / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new ServiceError(Messages.InvalidRequest, httpStatus.HTTP_STATUS_BAD_REQUEST);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > max) throw new ServiceError(sizeLimitMessage("请求内容"), httpStatus.HTTP_STATUS_PAYLOAD_TOO_LARGE);
  return bytes;
}
export function key(name: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(name)) throw new ServiceError(Messages.InvalidRequest, httpStatus.HTTP_STATUS_BAD_REQUEST);
  return name;
}
/** 兼容旧 ticket，同时绑定新客户端声明的 Y.Doc clientID；身份仍由 Go 校验。 */
export function authentication(token: string): {
  ticket: string;
  clientId: number | null;
} {
  if (typeof token !== 'string' || token.length > 8192)
    throw new ServiceError(Messages.InvalidRequest, httpStatus.HTTP_STATUS_BAD_REQUEST);
  // 旧版原始票据仍可同步正文，但不能认领 Awareness clientID。
  if (!token.startsWith('{')) return { ticket: token, clientId: null };
  let value: unknown;
  try {
    value = JSON.parse(token);
  } catch {
    throw new ServiceError(Messages.InvalidRequest, httpStatus.HTTP_STATUS_BAD_REQUEST);
  }
  if (!value || typeof value !== 'object')
    throw new ServiceError(Messages.InvalidRequest, httpStatus.HTTP_STATUS_BAD_REQUEST);
  const envelope = value as { ticket?: unknown; client_id?: unknown };
  if (
    typeof envelope.ticket !== 'string' ||
    !Number.isInteger(envelope.client_id) ||
    Number(envelope.client_id) < 0 ||
    Number(envelope.client_id) > 0xffffffff
  )
    throw new ServiceError(Messages.InvalidRequest, httpStatus.HTTP_STATUS_BAD_REQUEST);
  return { ticket: envelope.ticket, clientId: Number(envelope.client_id) };
}
export function checkSchema(value: { schema_version: string; epoch: number }) {
  if (value.schema_version !== SCHEMA_VERSION)
    throw new ServiceError(Messages.EditorVersionMismatch, httpStatus.HTTP_STATUS_CONFLICT);
  if (!Number.isSafeInteger(value.epoch) || value.epoch < 1)
    throw new ServiceError(Messages.DocumentChanged, httpStatus.HTTP_STATUS_CONFLICT);
}
export function announce(room: Room, payload: object) {
  for (const connection of room.doc.getConnections())
    connection.sendStateless(JSON.stringify(payload));
}
/** 仅根据已落库快照生成回执；带 request_id 的回执才对应客户端的一次保存确认。 */
export function receipt(room: Room, request_id?: string) {
  return {
    type: 'persisted',
    request_id,
    epoch: room.state.epoch,
    collab_seq: room.state.collab_seq,
    revision: room.state.revision,
    state_vector: room.state.state_base64
      ? base64(Y.encodeStateVectorFromUpdate(decode(room.state.state_base64)))
      : base64(Y.encodeStateVector(room.doc)),
  };
}
export function closeRoom(room: Room, reason: string, epoch = room.state.epoch) {
  announce(room, { type: 'room-closed', reason, epoch });
  for (const connection of room.doc.getConnections())
    connection.close({
      code: reason === 'authentication-expired' ? SocketCloseCode.AuthenticationExpired : SocketCloseCode.PermissionChanged,
      reason,
    });
}
/** 向量只确认插入时钟已到达，不能证明删除已落库；调用方仍须等待 flush。 */
export function included(doc: Y.Doc, vector: string) {
  const target = Y.decodeStateVector(decode(vector, 128 * 1024));
  const actual = Y.decodeStateVector(Y.encodeStateVector(doc));
  return [...target].every(([client, clock]) => (actual.get(client) || 0) >= clock);
}

/** Node 不直连数据库，所有鉴权、加载、初始化和保存都经由 Go 内部接口。 */
export function createBackendClient(config: CollaborationConfig) {
  const { api, secret } = config;
  async function go<T>(route: string, body: object): Promise<T> {
    let response: Response;
    try {
      response = await fetch(api + '/internal/collab/' + route, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Collab-Secret': secret,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      throw new ServiceError(Messages.NetworkError, httpStatus.HTTP_STATUS_BAD_GATEWAY, { cause: error });
    }
    if (!response.ok) {
      throw new ServiceError(messageForStatus(response.status), response.status, {
        cause: new Error(`backend ${route} returned HTTP ${response.status}`),
      });
    }
    let result: unknown;
    try { result = await response.json(); }
    catch (error) {
      throw new ServiceError(Messages.NetworkError, httpStatus.HTTP_STATUS_BAD_GATEWAY, { cause: error });
    }
    return result as T;
  }
  return go;
}
export type BackendClient = ReturnType<typeof createBackendClient>;
