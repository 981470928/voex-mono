/** 持久化与重试，不持有数据库连接，也不负责 WebSocket 消息解析。 */
import { randomUUID } from 'node:crypto';
import { SCHEMA_VERSION } from '@voex/editor-schema';
import { MAX_STATE } from './config.js';
import type { DocumentCodec } from './documents.js';
import { announce, closeRoom, receipt, ServiceError, type BackendClient } from './protocol.js';
import type { Receipt, Room } from './types.js';

type PersistenceDependencies = {
  rooms: Map<string, Room>;
  go: BackendClient;
  snapshot: DocumentCodec['snapshot'];
  isDraining: () => boolean;
  expireRoomAuthorization: (room: Room) => void;
  discardRoom: (room: Room, reason: string, epoch?: number) => void;
};

export function createPersistence({
  rooms,
  go,
  snapshot,
  isDraining,
  expireRoomAuthorization,
  discardRoom,
}: PersistenceDependencies) {
  /** 401 触发重新握手，403 停止写入，409 要求重载；临时故障保留脏状态并安排重试。 */
  function storeFailed(room: Room, error: unknown, request_id?: string) {
    if (rooms.get(room.state.file_key) !== room) return;
    const status = error instanceof ServiceError ? error.status : 503;
    if (status === 401 || room.authExpired) {
      expireRoomAuthorization(room);
      return;
    }
    announce(room, {
      type: 'persistence-error',
      request_id,
      message: error instanceof Error ? error.message : '保存失败，请保留当前页面',
      retryable: status >= 500,
    });
    if (status === 403) {
      room.blocked = true;
      setImmediate(() => {
        if (rooms.get(room.state.file_key) === room) discardRoom(room, 'permission-changed');
      });
    }
    if (status === 409) {
      room.invalid = true;
      closeRoom(room, 'document-replaced');
    }
    if (!room.retry && !room.invalid && !room.blocked && !isDraining()) {
      room.retry = setTimeout(() => {
        room.retry = undefined;
        void persist(room).catch(() => undefined);
      }, 5000);
      room.retry.unref();
    }
  }
  /** 每个房间只运行一个保存请求；网络失败时复用 pendingCommit，不重新生成幂等键。 */
  async function persist(room: Room): Promise<Receipt> {
    if (room.authExpired || rooms.get(room.state.file_key) !== room)
      throw new ServiceError('Authorization needs renewal', 401);
    if (room.invalid) throw new ServiceError('文档状态已变化，请重新连接', 409);
    if (room.persist) return room.persist;
    room.persist = (async () => {
      if (room.savedVersion >= room.version && !room.pendingCommit) return room.state;
      if (!room.pendingCommit) {
        const version = room.version;
        const data = snapshot(room.doc);
        if (Buffer.byteLength(data.state, 'base64') > MAX_STATE)
          throw new ServiceError('协同文档超过大小限制', 413);
        const actors = [...room.actors].filter(([, n]) => n <= version).map(([id]) => id);
        if (!actors.length) throw new ServiceError('Missing editing authorization', 403);
        room.pendingCommit = {
          version,
          actors,
          request: {
            file_key: room.state.file_key,
            authorization_id: actors[actors.length - 1],
            actors,
            expected_collab_seq: room.state.collab_seq,
            epoch: room.state.epoch,
            schema_version: SCHEMA_VERSION,
            state_base64: data.state,
            markdown: data.markdown,
            idempotency_key: randomUUID(),
          },
        };
      }
      const pending = room.pendingCommit;
      const authorizationSnapshot = () => {
        const request = pending.request as {
          authorization_id: string;
          actors: string[];
        };
        return JSON.stringify([request.authorization_id, request.actors]);
      };
      const requestedAuthorization = authorizationSnapshot();
      let result: Receipt;
      try {
        result = await go<Receipt>('commit', pending.request);
      } catch (error) {
        // 保存请求在途时可能完成续票并替换授权。
        // 使用已验证的新授权重试一次，但必须保留原幂等键。
        if (
          error instanceof ServiceError &&
          error.status === 401 &&
          requestedAuthorization !== authorizationSnapshot()
        )
          result = await go<Receipt>('commit', pending.request);
        else throw error;
      }
      const written = pending.request as {
        state_base64: string;
        markdown: string;
      };
      room.state = {
        ...room.state,
        ...result,
        state_base64: written.state_base64,
        markdown: written.markdown,
      };
      room.savedVersion = pending.version;
      for (const id of pending.actors)
        if ((room.actors.get(id) || 0) <= pending.version) room.actors.delete(id);
      room.pendingCommit = undefined;
      announce(room, receipt(room));
      return result;
    })();
    try {
      return await room.persist;
    } catch (error) {
      storeFailed(room, error);
      throw error;
    } finally {
      room.persist = undefined;
    }
  }
  /** 等待调用时已存在的所有改动落库；等待过程中产生的新改动继续保持脏状态。 */
  async function flush(room: Room) {
    // 每轮在网络请求前同步取快照，后续编辑仍保留自己的脏版本。
    const target = room.version;
    do {
      await persist(room);
    } while (room.savedVersion < target);
  }
  return { persist, flush };
}
