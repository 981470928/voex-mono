import axios from 'axios';
import http, { authHttp } from './https';
import {
  acceptSession,
  accessToken,
  accessExpiresAt,
  authUser,
  type AuthSession,
  type Creator,
} from '../auth-session';
import type { DocumentPermissions, FileInfo } from './document-api';
import type { DownloadOptions } from './upload-api';

export type SharePermission = 'read' | 'edit';

export interface ShareLink {
  permission: SharePermission;
  token: string;
  enabled: boolean;
}
export interface FileGrant {
  user_id: string;
  name: string;
  permission: SharePermission;
  member: boolean;
}
export interface SharingSettings {
  links: ShareLink[];
  can_manage: boolean;
  access: FileGrant[];
}

export interface SharedFile {
  content_mode?: 'legacy' | 'collab';
  schema_version?: string;
  epoch?: number;
  file_key: string;
  file_name: string;
  file_content: string | null;
  created_at: string;
  updated_at: string;
  creator: Creator;
  revision: number;
  privileges: { mode: 'inherit' };
  permissions: DocumentPermissions;
  attachments: FileInfo[];
}

export function getFileSharing(key: string, signal?: AbortSignal) {
  return http.get<unknown, SharingSettings>(`/document/${encodeURIComponent(key)}/sharing`, {
    signal,
  });
}
export function setFileSharing(key: string, permission: SharePermission, enabled: boolean) {
  return http.patch<unknown, { success: boolean }>(`/document/${encodeURIComponent(key)}/sharing`, {
    permission,
    enabled,
  });
}
export function revokeFileAccess(key: string, userId: string) {
  return http.delete<unknown, { success: boolean }>(
    `/document/${encodeURIComponent(key)}/access/${encodeURIComponent(userId)}`
  );
}

export function fileShareUrl(token: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}share#${encodeURIComponent(token)}`;
}

// Public links remain usable when a login session is absent or expired.
// Do not use the authenticated client's recovery interceptor here.
const sharedHttp = axios.create({
  baseURL: http.defaults.baseURL,
  timeout: 30000,
  withCredentials: true,
});

export async function restoreOptionalShareSession() {
  if (accessToken.value && accessExpiresAt.value > Date.now() + 30000) return;
  try {
    const { data } = await authHttp.post<AuthSession>('/auth/refresh');
    if (!authUser.value || authUser.value.id === data.user.id) acceptSession(data);
  } catch {
    // A failed optional login must not interrupt anonymous file access.
  }
}

function shareHeaders(token: string) {
  return {
    'X-Share-Token': token,
    ...(accessToken.value && accessExpiresAt.value > Date.now()
      ? { Authorization: `Bearer ${accessToken.value}` }
      : {}),
  };
}

export async function getSharedFile(token: string, signal?: AbortSignal) {
  const { data } = await sharedHttp.get<SharedFile>('/shared-file', {
    headers: shareHeaders(token),
    signal,
  });
  return data;
}

export async function downloadSharedAttachment(
  token: string,
  hash: string,
  options: DownloadOptions = {}
) {
  const { data } = await sharedHttp.get<Blob>(
    `/shared-file/attachments/${encodeURIComponent(hash)}`,
    { ...options, headers: shareHeaders(token), responseType: 'blob', timeout: 0 }
  );
  return data;
}
