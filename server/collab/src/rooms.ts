/** 房间注册表、权限刷新和生命周期。每次创建服务都有独立状态，模块间不共享全局单例。 */
import type { Hocuspocus, Document, Connection } from '@hocuspocus/server';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { SCHEMA_VERSION } from '@voex/editor-schema';
import type { DocumentCodec } from './documents.js';
import { createPersistence } from './persistence.js';
import {
  announce,
  checkSchema,
  closeRoom,
  decode,
  receipt,
  ServiceError,
  type BackendClient,
} from './protocol.js';
import type { Context, Grant, Room, Stored } from './types.js';

export function createRoomService(
  go: BackendClient,
  documents: DocumentCodec,
  getHocuspocus: () => Hocuspocus
) {
  const rooms = new Map<string, Room>();
  const checks = new WeakMap<Connection, number>();
  const { codec, snapshot } = documents;
  let draining = false;
  const { persist, flush } = createPersistence({
    rooms,
    go,
    snapshot,
    isDraining: () => draining,
    expireRoomAuthorization,
    discardRoom,
  });

  /** 短期缓存鉴权结果；异步返回时核对授权 ID，避免旧请求覆盖已续期的授权。 */
  async function authorize(connection: Connection, force = false) {
    const context = connection.context as Context;
    if (!context.grant) throw new ServiceError('Missing authorization', 401);
    if (!force && Date.now() - (checks.get(connection) || 0) < 5000) return context.grant;
    const requested = context.grant.authorization_id;
    let grant: Grant;
    try {
      grant = await go<Grant>('authorize', {
        authorization_id: requested,
        file_key: context.grant.file_key,
      });
    } catch (error) {
      const current = (connection.context as Context).grant;
      if (current.authorization_id !== requested) return current;
      throw error;
    }
    const current = (connection.context as Context).grant;
    if (current.authorization_id !== requested) return current;
    checkSchema(grant);
    const room = rooms.get(grant.file_key);
    if (room && grant.epoch !== room.state.epoch) {
      closeRoom(room, 'document-replaced', grant.epoch);
      throw new ServiceError('Document replaced', 409);
    }
    connection.readOnly = !grant.permissions.write;
    context.grant = grant;
    checks.set(connection, Date.now());
    connection.sendStateless(
      JSON.stringify({ type: 'permission', permissions: grant.permissions })
    );
    return grant;
  }
  /** 移除业务房间和 Hocuspocus 文档必须使用对象身份判断，防止旧回调清理新房间。 */
  function discardRoom(room: Room, reason: string, epoch = room.state.epoch) {
    room.invalid = true;
    room.blocked = true;
    closeRoom(room, reason, epoch);
    unlock(room);
    if (room.retry) clearTimeout(room.retry);
    if (rooms.get(room.state.file_key) === room) rooms.delete(room.state.file_key);
    if (getHocuspocus().documents.get(room.state.file_key) === room.doc)
      getHocuspocus().documents.delete(room.state.file_key);
    room.doc.destroy();
  }
  /** Go 重启会丢失内存授权；通知客户端重新取票，不把它误报为永久权限撤销。 */
  function expireRoomAuthorization(room: Room) {
    if (rooms.get(room.state.file_key) !== room || room.authExpired) return;
    room.authExpired = true;
    room.blocked = true;
    // Go 重启会丢失内存授权；这是可恢复的握手过渡，
    // 不能按永久文档权限失败处理。
    announce(room, {
      type: 'room-closed',
      reason: 'authentication-expired',
      epoch: room.state.epoch,
    });
    setImmediate(() => {
      if (rooms.get(room.state.file_key) === room) discardRoom(room, 'authentication-expired');
    });
  }
  function expireConnectionAuthorization(connection: Connection) {
    const room = rooms.get(connection.document.name);
    const grant = (connection.context as Context).grant;
    if (room?.doc === connection.document && room.actors.has(grant.authorization_id)) {
      expireRoomAuthorization(room);
      return;
    }
    connection.sendStateless(
      JSON.stringify({
        type: 'room-closed',
        reason: 'authentication-expired',
        epoch: room?.doc === connection.document ? room.state.epoch : grant.epoch,
      })
    );
    connection.close({ code: 4001, reason: 'authentication-expired' });
  }
  /** 首次连接才将 legacy Markdown 转为 Yjs；初始化冲突时重新读取后端赢家状态。 */
  async function loadRoom(document: Document, grant: Grant): Promise<Room> {
    let state = await go<Stored>('load', {
      file_key: grant.file_key,
      authorization_id: grant.authorization_id,
    });
    checkSchema(state);
    if (state.content_mode === 'legacy') {
      const initial = new Y.Doc();
      try {
        prosemirrorToYXmlFragment(
          codec.parse(state.markdown),
          initial.getXmlFragment('prosemirror')
        );
        const converted = snapshot(initial);
        try {
          state = await go<Stored>('initialize', {
            file_key: grant.file_key,
            authorization_id: grant.authorization_id,
            expected_revision: state.revision,
            source_markdown: state.markdown,
            markdown: converted.markdown,
            state_base64: converted.state,
            schema_version: SCHEMA_VERSION,
          });
        } catch (error) {
          if (!(error instanceof ServiceError) || error.status !== 409) throw error;
          state = await go<Stored>('load', {
            file_key: grant.file_key,
            authorization_id: grant.authorization_id,
          });
        }
      } finally {
        initial.destroy();
      }
    }
    if (!state.state_base64 || state.content_mode !== 'collab')
      throw new ServiceError('文档初始化未完成', 409);
    Y.applyUpdate(document, decode(state.state_base64), 'load');
    snapshot(document);
    const room: Room = {
      doc: document,
      state,
      version: 0,
      savedVersion: 0,
      actors: new Map(),
      presenceOwners: new Map(),
      lastAuth: grant.authorization_id,
      messages: Promise.resolve(),
      invalid: false,
      blocked: false,
      authExpired: false,
      suppress: false,
    };
    rooms.set(grant.file_key, room);
    document.on('update', (_update: Uint8Array, origin: unknown) => {
      if (room.suppress || origin === 'load' || origin === 'ai-commit') return;
      const connection = origin as Connection | undefined;
      const actor = (connection?.context as Context | undefined)?.grant?.authorization_id;
      if (!actor) {
        room.invalid = true;
        closeRoom(room, 'unsupported-update');
        return;
      }
      room.version++;
      room.lastAuth = actor;
      room.actors.set(actor, room.version);
    });
    return room;
  }
  /** AI 审阅先排空已有消息并保存，再暂停后续写入；这是事务屏障，不是用户行锁。 */
  async function lockRoom(room: Room, operation: string) {
    if (room.prepared && room.prepared !== operation)
      throw new ServiceError('另一个审阅正在应用', 409);
    room.prepared = operation;
    try {
      const pending = room.messages;
      let reached!: () => void;
      room.messages = new Promise<void>((resolve) => {
        reached = resolve;
      });
      await pending;
      room.gate ??= new Promise<void>((resolve) => {
        room.release = resolve;
      });
      reached();
      await flush(room);
    } catch (error) {
      if (room.prepared === operation) unlock(room);
      throw error;
    }
  }
  /** 释放事务屏障；无人在线时交还 Hocuspocus 执行卸载。 */
  function unlock(room: Room) {
    room.prepared = undefined;
    room.gate = undefined;
    room.release?.();
    room.release = undefined;
    if (!room.invalid && room.doc.getConnectionsCount() === 0)
      setImmediate(() => void getHocuspocus().unloadDocument(room.doc));
  }
  /** 以 Go 已提交状态为准恢复；epoch 变化时必须丢弃旧 Y.Doc。 */
  async function reload(room: Room) {
    if (room.persist) await room.persist.catch(() => undefined);
    const state = await go<Stored>('load', {
      file_key: room.state.file_key,
      authorization_id: room.lastAuth,
    });
    checkSchema(state);
    if (state.epoch !== room.state.epoch) {
      discardRoom(room, 'document-replaced', state.epoch);
      return;
    }
    // epoch 相同的已提交 AI 更新属于同一段 CRDT 历史，直接合并即可。
    room.suppress = true;
    try {
      Y.applyUpdate(room.doc, decode(state.state_base64), 'ai-commit');
    } finally {
      room.suppress = false;
    }
    room.state = state;
    if (room.prepared) {
      room.version++;
      room.savedVersion = room.version;
      room.actors.clear();
      room.pendingCommit = undefined;
    }
    room.invalid = false;
    room.blocked = false;
    unlock(room);
    announce(room, receipt(room));
  }
  /** 停机先拒绝新更新，再等待已接收消息和持久化完成；失败时不能宣称排空成功。 */
  async function drain() {
    draining = true;
    for (const room of rooms.values()) {
      if (room.prepared) throw new ServiceError('仍有审阅事务等待确认，请稍后重试排空', 409);
      await room.messages;
      await flush(room);
    }
    for (const room of rooms.values()) closeRoom(room, 'maintenance');
    return { success: true, draining: true };
  }
  return {
    rooms,
    checks,
    authorize,
    discardRoom,
    expireRoomAuthorization,
    expireConnectionAuthorization,
    persist,
    flush,
    loadRoom,
    lockRoom,
    unlock,
    reload,
    drain,
    isDraining: () => draining,
  };
}
export type RoomService = ReturnType<typeof createRoomService>;
