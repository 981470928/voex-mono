/** ---------- Document history APIs ---------- / 文档历史 API */
import http from './https';
import type { ApiError } from './index';

export type DocumentVersionKind = 'auto' | 'manual' | 'backup';

export interface DocumentVersionCreator {
  id: string;
  name: string | null;
  avator: string | null;
}

export interface DocumentVersionInfo {
  id: number;
  revision: number;
  kind: DocumentVersionKind;
  label: string;
  size: number;
  created_at: string;
  created_by_anonymous: boolean;
  creator: DocumentVersionCreator | null;
}

export interface DocumentVersionDetail extends DocumentVersionInfo {
  content: string;
}

export interface DocumentVersionList {
  items: DocumentVersionInfo[];
  next_cursor: string;
}

export interface RestoreDocumentVersionResult {
  success: boolean;
  revision: number;
  restored_from: number;
  pre_restore_version_id: number;
}

/** 列出版本元数据（不含正文）；limit 必填，before 为游标版本 id。 */
export function listDocumentVersions(file_key: string, limit: number, before?: number) {
  return http.get<ApiError, DocumentVersionList>(
    `/document/${encodeURIComponent(file_key)}/versions`,
    { params: { limit, before } }
  );
}

/** 读取单个版本全文。 */
export function getDocumentVersion(file_key: string, versionId: number) {
  return http.get<ApiError, DocumentVersionDetail>(
    `/document/${encodeURIComponent(file_key)}/versions/${versionId}`
  );
}

/** 把当前正文保存为命名版本。 */
export function createDocumentVersion(file_key: string, label?: string) {
  return http.post<ApiError, DocumentVersionInfo>(
    `/document/${encodeURIComponent(file_key)}/versions`,
    { label }
  );
}

/** 删除命名版本；其他类型不可删。 */
export function deleteDocumentVersion(file_key: string, versionId: number) {
  return http.delete<ApiError, { success: boolean }>(
    `/document/${encodeURIComponent(file_key)}/versions/${versionId}`
  );
}

/** 恢复到指定版本；恢复前自动保护当前内容。 */
export function restoreDocumentVersion(file_key: string, versionId: number) {
  return http.post<ApiError, RestoreDocumentVersionResult>(
    `/document/${encodeURIComponent(file_key)}/versions/${versionId}/restore`
  );
}
