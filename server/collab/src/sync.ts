/** 文档同步 hooks：加载、更新校验、显式保存确认以及安全卸载。 */
import type { Connection, ServerConfiguration } from '@hocuspocus/server';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import { MAX_MESSAGE } from './config.js';
import type { DocumentCodec } from './documents.js';
import type { RoomService } from './rooms.js';
import { applyPresence } from './presence.js';
import { included, receipt, ServiceError } from './protocol.js';
import type { Context } from './types.js';

export function createDocumentHooks(service: RoomService, snapshot: DocumentCodec['snapshot']) {
  const { rooms, authorize, expireConnectionAuthorization, loadRoom, flush, persist } = service;
  /** 按房间串行验证更新，在隔离候选 Y.Doc 中校验 schema 后才发布；删除操作也走同一队列。 */
  async function message(data: {
    connection: Connection;
    documentName: string;
    update: Uint8Array;
  }) {
    const room = rooms.get(data.documentName);
    if (room && (room.doc !== data.connection.document || room.authExpired))
      throw new ServiceError('Authorization needs renewal', 401);
    if (!room || room.invalid || service.isDraining())
      throw new ServiceError('协同文档暂不可用', 503);
    const previous = room.messages;
    let release!: () => void;
    room.messages = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (room.gate) await room.gate;
      if (room.authExpired || rooms.get(data.documentName) !== room)
        throw new ServiceError('Authorization needs renewal', 401);
      if (room.invalid || service.isDraining()) throw new ServiceError('协同文档暂不可用', 503);
      const decoder = decoding.createDecoder(data.update);
      if (decoding.readVarString(decoder) !== room.state.file_key)
        throw new ServiceError('Document mismatch', 400);
      const type = decoding.readVarUint(decoder);
      // 客户端不得伪造服务端的持久化或权限广播。
      if (type === 6) throw new ServiceError('Client broadcasts are not supported', 403);
      if (type === 2) return; // 续票由 onTokenSync 校验。
      const grant = await authorize(data.connection);
      if (data.connection.webSocket.readyState !== 1)
        throw new ServiceError('Connection closed', 499);
      if (type === 1)
        applyPresence(room, data.connection, decoding.readVarUint8Array(decoder), grant);
      if (type === 0 || type === 4) {
        const syncType = decoding.readVarUint(decoder);
        if (syncType === 1 || syncType === 2) {
          const update = decoding.readVarUint8Array(decoder);
          if (update.byteLength > MAX_MESSAGE) throw new ServiceError('Update too large', 413);
          if (room.blocked && !Y.snapshotContainsUpdate(Y.snapshot(room.doc), update))
            throw new ServiceError('存储授权已失效，请保留当前页面并重新登录', 403);
          if (!grant.permissions.write) {
            if (!Y.snapshotContainsUpdate(Y.snapshot(room.doc), update))
              throw new ServiceError('没有编辑权限', 403);
            return;
          }
          // 先校验再广播；在这里串行应用真实更新，包括删除集合。
          // Hocuspocus 随后重复应用同一更新是幂等的。
          const candidate = new Y.Doc();
          try {
            Y.applyUpdate(candidate, Y.encodeStateAsUpdate(room.doc));
            Y.applyUpdate(candidate, update);
            snapshot(candidate);
            Y.applyUpdate(room.doc, update, data.connection);
          } finally {
            candidate.destroy();
          }
        }
      }
    } finally {
      release();
    }
  }
  const hooks: Pick<
    ServerConfiguration,
    | 'onLoadDocument'
    | 'beforeHandleMessage'
    | 'onStateless'
    | 'onDisconnect'
    | 'onStoreDocument'
    | 'beforeUnloadDocument'
    | 'afterUnloadDocument'
  > = {
    async onLoadDocument({ document, context }) {
      try {
        await loadRoom(document, (context as Context).grant);
      } catch (error) {
        document.destroy();
        throw error;
      }
    },
    async beforeHandleMessage(data) {
      try {
        await message(data);
      } catch (error) {
        if (error instanceof ServiceError && error.status === 401) {
          expireConnectionAuthorization(data.connection);
          throw { code: 4001, reason: 'authentication-expired' };
        }
        data.connection.sendStateless(
          JSON.stringify({
            type: 'persistence-error',
            message: error instanceof Error ? error.message : '协同更新失败',
            retryable: error instanceof ServiceError && error.status >= 500,
          })
        );
        const temporary = error instanceof ServiceError && error.status >= 500;
        throw {
          code: temporary
            ? 1013
            : error instanceof ServiceError && error.status === 401
              ? 4001
              : 4003,
          reason: temporary ? 'service-unavailable' : 'collaboration-update-rejected',
        };
      }
    },
    /** flush 回执必须等待落库；state vector 检查不能替代持久化确认。 */
    async onStateless({ connection, documentName, payload }) {
      let request: any;
      try {
        if (payload.length > 200000) throw new ServiceError('Flush request too large', 413);
        request = JSON.parse(payload);
        if (
          request.type !== 'flush' ||
          typeof request.request_id !== 'string' ||
          request.request_id.length > 128
        )
          throw new ServiceError('Invalid flush request', 400);
        const room = rooms.get(documentName);
        if (room && (room.doc !== connection.document || room.authExpired))
          throw new ServiceError('Authorization needs renewal', 401);
        if (!room || room.invalid || request.epoch !== room.state.epoch)
          throw new ServiceError('文档状态已变化', 409);
        if (room.gate) await room.gate;
        await authorize(connection, true);
        if (!included(room.doc, request.state_vector))
          throw new ServiceError('本地修改尚未到达服务器，请重试保存', 409);
        await flush(room);
        connection.sendStateless(JSON.stringify(receipt(room, request.request_id)));
      } catch (error) {
        if (error instanceof ServiceError && error.status === 401) {
          expireConnectionAuthorization(connection);
          return;
        }
        connection.sendStateless(
          JSON.stringify({
            type: 'persistence-error',
            request_id: request?.request_id,
            message: error instanceof Error ? error.message : '保存失败',
            retryable: true,
          })
        );
      }
    },
    async onDisconnect({ documentName, socketId }) {
      const room = rooms.get(documentName);
      if (room)
        for (const [client, owner] of room.presenceOwners)
          if (owner.connection.socketId === socketId) room.presenceOwners.delete(client);
    },
    async onStoreDocument({ documentName }) {
      const room = rooms.get(documentName);
      // 显式 flush 会向调用方报告失败；后台防抖保存不能产生未处理的拒绝，
      // persist 会保留脏状态并安排重试。
      if (room) await persist(room).catch(() => undefined);
    },
    async beforeUnloadDocument({ documentName, document }) {
      const room = rooms.get(documentName);
      if (room && room.doc !== document) throw null;
      if (room && (room.prepared || room.savedVersion < room.version || room.pendingCommit))
        throw null;
    },
    async afterUnloadDocument({ documentName }) {
      const room = rooms.get(documentName);
      if (room?.retry) clearTimeout(room.retry);
      rooms.delete(documentName);
    },
  };
  return hooks;
}
