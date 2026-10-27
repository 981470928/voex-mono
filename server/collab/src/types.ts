/** 跨模块共享的数据契约；这里不创建状态、不执行网络请求。 */
import type { Document, Connection } from '@hocuspocus/server';

export type Permissions = { read: boolean; write: boolean };
/** Go 签发的短期授权；权限和 epoch 都必须服从后端当前状态。 */
export type Grant = {
  authorization_id: string;
  file_key: string;
  document_name: string;
  epoch: number;
  schema_version: string;
  expires_at: string;
  permissions: Permissions;
  user: { id: string; name: string; color?: string; avator?: string };
  file_name?: string;
};
/** 数据库快照：collab_seq 用于提交 CAS，epoch 用于隔离整篇替换前后的 CRDT 历史。 */
export type Stored = {
  state_base64: string;
  markdown: string;
  file_key: string;
  file_name: string;
  revision: number;
  collab_seq: number;
  epoch: number;
  schema_version: string;
  content_mode: 'legacy' | 'collab';
};
export type Receipt = { collab_seq: number; revision: number; epoch: number };
export type Context = { grant: Grant; clientId: number | null };
/** 单篇文档的内存状态。version/savedVersion 是本进程脏版本，不等于数据库 revision。 */
export type Room = {
  doc: Document;
  state: Stored;
  version: number;
  savedVersion: number;
  // 每个编辑授权最后贡献的本地版本，用于提交校验和安全清理。
  actors: Map<string, number>;
  lastAuth: string;
  persist?: Promise<Receipt>;
  presenceOwners: Map<number, { userId: string; connection: Connection }>;
  // 保存失败后保留完全相同的提交请求与幂等键，避免重试重复写入。
  pendingCommit?: { request: object; version: number; actors: string[] };
  // messages 串行化消息；gate 仅在 AI 审阅事务期间暂停后续写入。
  messages: Promise<void>;
  gate?: Promise<void>;
  release?: () => void;
  prepared?: string;
  invalid: boolean;
  blocked: boolean;
  authExpired: boolean;
  suppress: boolean;
  retry?: NodeJS.Timeout;
};
/** AI 准备阶段的候选快照与租约；Go 提交成功前不得发布到实时房间。 */
export type Stage = {
  operation_id: string;
  expires_at: string;
  rooms: {
    room: Room;
    update: Uint8Array;
    state: string;
    markdown: string;
    source_markdown: string;
  }[];
  timer: NodeJS.Timeout;
  result: object;
};
