/** ---------- Document APIs ---------- */
import http from './https';
import type { ApiError } from './index';
import type { Creator } from '@/service/auth-session';

export interface UploadResult {
  hash: string;
  creator: Creator;
}

export interface FileInfo {
  hash: string;
  name: string;
  mime: string;
  creator: Creator;
}

export interface DocumentPermissions {
  remove?: boolean;
  children_remove?: boolean;
  read: boolean;
  write: boolean;
  manage: boolean;
  share: boolean;
}

export interface FilePath {
  team_key: string;
  project_key: string;
  project_name: string;
  folder_key: string;
  folder_name: string;
}

export interface FileDetails {
  file_key: string;
  file_name: string;
  created_at: string;
  updated_at: string;
  updated_by: Pick<Creator, 'id' | 'name'> | null;
  updated_by_kind: 'user' | 'anonymous' | 'unknown';
  access: 'project' | 'share';
  permissions: DocumentPermissions;
  path: FilePath | null;
}

export interface DocumentSummary {
  id: number;
  file_key: string;
  file_name: string;
  project_key: string;
  folder_key: string;
  created_at: string;
  updated_at: string;
  creator: Creator;
  privileges: { mode: 'inherit' };
  revision: number;
  permissions?: DocumentPermissions;
}

export interface DocumentInfo extends DocumentSummary {
  content_mode?: 'legacy' | 'collab';
  schema_version?: string;
  epoch?: number;
  file_content: string | null;
  permissions: DocumentPermissions;
}

export interface CreateDocumentResult {
  file_key: string;
  file_name: string;
  project_key: string;
  folder_key: string;
  project_name: string;
  folder_path: string[];
  creator: Creator;
}

export interface CreateDocumentInput {
  team_key?: string;
  file_name?: string;
  project_key?: string;
  folder_key?: string;
}

/** 创建文档 */
export function createDocument(data: CreateDocumentInput) {
  return http.post<ApiError, CreateDocumentResult>('/document', data);
}

export function getDocument(file_key: string, signal?: AbortSignal) {
  return http.get<ApiError, DocumentInfo>(`/document/${encodeURIComponent(file_key)}`, { signal });
}

export function getDocumentDetails(fileKey: string, signal?: AbortSignal) {
  return http.get<ApiError, FileDetails>(`/document/${encodeURIComponent(fileKey)}/details`, {
    signal,
  });
}

/** 修改文档名称；正文统一由协同 WebSocket 保存。 */
export function updateDocument(file_key: string, data: { file_name: string }) {
  return http.put<ApiError, { success: boolean; revision: number }>(
    `/document/${encodeURIComponent(file_key)}`,
    data
  );
}

/** 将文档移入回收站，保留正文与附件关联。 */
export function deleteDocument(file_key: string) {
  return http.delete<ApiError, { success: boolean }>(`/document/${encodeURIComponent(file_key)}`);
}

/**
 * 查询文档
 * code 为空则查询全部
 *  */
export function queryDocuments(code?: string) {
  return http.get<ApiError, DocumentSummary[]>('/documents', { params: { code } });
}
