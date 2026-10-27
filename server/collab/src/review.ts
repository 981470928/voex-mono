/** AI 审阅的 prepare / commit / abort 协议及租约。数据库事务归 Go 管理。 */
import { randomUUID } from 'node:crypto';
import type { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { SCHEMA_VERSION } from '@voex/editor-schema';
import type { DocumentCodec } from './documents.js';
import type { RoomService } from './rooms.js';
import {
  announce,
  checkSchema,
  key,
  receipt,
  ServiceError,
  type BackendClient,
} from './protocol.js';
import type { Grant, Stage, Stored } from './types.js';

export function createReviewService(
  service: RoomService,
  go: BackendClient,
  documents: DocumentCodec,
  getHocuspocus: () => Hocuspocus
) {
  const { rooms, lockRoom, unlock, reload, discardRoom } = service;
  const { codec, snapshot } = documents;
  const stages = new Map<string, Stage>();

  /** 按文件键排序取得事务屏障；只构造候选文档，Go 确认提交前不修改正在广播的正文。 */
  async function prepare(body: any) {
    const operation = String(body.operation_id || '');
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(operation) ||
      !Array.isArray(body.changes) ||
      body.changes.length > 20
    )
      throw new ServiceError('Invalid preparation request', 400);
    if (stages.has(operation)) return stages.get(operation)!.result;
    const prepared: any[] = [];
    const entries: Stage['rooms'] = [];
    try {
      for (const change of [...body.changes].sort((a: any, b: any) =>
        String(a.file_key).localeCompare(String(b.file_key))
      )) {
        const fileKey = key(change.file_key);
        let room = rooms.get(fileKey);
        if (!room) {
          const grant = await go<Grant>('authorize', {
            authorization_id: change.authorization_id,
            file_key: fileKey,
          });
          checkSchema(grant);
          if (!grant.permissions.write) throw new ServiceError('没有编辑权限', 403);
          await getHocuspocus().createDocument(
            fileKey,
            {},
            randomUUID(),
            { isAuthenticated: true, readOnly: false },
            { grant, clientId: null }
          );
          room = rooms.get(fileKey);
          if (!room) throw new ServiceError('Cannot load collaboration room');
        }
        await lockRoom(room, operation);
        entries.push({
          room,
          update: new Uint8Array(),
          state: '',
          markdown: '',
          source_markdown: String(change.after_content),
        });
        const latest = await go<Stored>('load', {
          file_key: fileKey,
          authorization_id: change.authorization_id || room.lastAuth,
        });
        room.state.file_name = latest.file_name;
        const current = snapshot(room.doc);
        if (
          room.state.revision !== change.revision ||
          current.markdown !== change.before_content ||
          room.state.file_name !== change.before_name
        )
          throw new ServiceError('文件已发生变化，请基于最新文档重新生成建议', 409);
        const copy = new Y.Doc();
        try {
          // 经审阅的整篇替换会开启新的 epoch 和 CRDT 身份。
          const beforeVector = Y.encodeStateVector(copy);
          prosemirrorToYXmlFragment(
            codec.parse(String(change.after_content)),
            copy.getXmlFragment('prosemirror')
          );
          const converted = snapshot(copy);
          const entry = entries[entries.length - 1]!;
          entry.update = Y.encodeStateAsUpdate(copy, beforeVector);
          entry.state = converted.state;
          entry.markdown = converted.markdown;
          prepared.push({
            file_key: fileKey,
            state_base64: converted.state,
            markdown: converted.markdown,
            source_markdown: change.after_content,
            expected_collab_seq: room.state.collab_seq,
            epoch: room.state.epoch,
            schema_version: SCHEMA_VERSION,
            revision: room.state.revision,
          });
        } finally {
          copy.destroy();
        }
      }
      const expires_at = new Date(Date.now() + 30000).toISOString();
      const result = { operation_id: operation, expires_at, prepared };
      const timer = setTimeout(() => {
        // Go 的事务超时早于本租约；租约到期后不能直接恢复旧实时文档，
        // 应丢弃房间，让下次授权连接加载后端已提交或回滚后的状态。
        for (const entry of entries) discardRoom(entry.room, 'review-outcome-pending');
        stages.delete(operation);
      }, 30000);
      timer.unref();
      stages.set(operation, {
        operation_id: operation,
        expires_at,
        rooms: entries,
        timer,
        result,
      });
      return result;
    } catch (error) {
      for (const entry of entries) unlock(entry.room);
      throw error;
    }
  }
  /** Go 事务提交后的确认阶段；epoch 变化则让客户端重建连接，丢失回执时可安全重试。 */
  async function finalize(body: any) {
    const stage = stages.get(String(body.operation_id));
    if (!stage) return { success: true };
    clearTimeout(stage.timer);
    for (const entry of stage.rooms) {
      const committed = body.committed?.find(
        (item: any) =>
          item.file_key === entry.room.state.file_key && Number.isSafeInteger(item.collab_seq)
      );
      if (!committed) {
        await reload(entry.room);
        continue;
      }
      if (committed.epoch !== entry.room.state.epoch) {
        discardRoom(entry.room, 'document-replaced', committed.epoch);
        continue;
      }
      entry.room.suppress = true;
      try {
        Y.applyUpdate(entry.room.doc, entry.update, 'ai-commit');
      } finally {
        entry.room.suppress = false;
      }
      entry.room.state = {
        ...entry.room.state,
        ...committed,
        markdown: entry.markdown,
        state_base64: entry.state,
      };
      entry.room.version++;
      entry.room.savedVersion = entry.room.version;
      entry.room.actors.clear();
      entry.room.pendingCommit = undefined;
      unlock(entry.room);
      announce(entry.room, receipt(entry.room));
    }
    stages.delete(stage.operation_id);
    return { success: true };
  }
  /** 中止也从 Go 重载，兼容“数据库已提交但响应丢失”的不确定结果。 */
  async function abort(body: any) {
    const stage = stages.get(String(body.operation_id));
    if (!stage) return { success: true };
    clearTimeout(stage.timer);
    // 提交成功后响应也可能丢失；以 Go 为准重载，使这种情况下的 abort 仍然安全。
    for (const entry of stage.rooms) await reload(entry.room);
    stages.delete(stage.operation_id);
    return { success: true };
  }
  return { stages, prepare, finalize, abort };
}
export type ReviewService = ReturnType<typeof createReviewService>;
