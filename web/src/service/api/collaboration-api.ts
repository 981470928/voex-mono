import axios from 'axios';
import http, { refreshSession } from './https';
import { accessExpiresAt, accessToken } from '../auth-session';
import { restoreOptionalShareSession } from './share-api';
import type { DocumentPermissions } from './document-api';

export { SCHEMA_VERSION as COLLABORATION_SCHEMA_VERSION } from '@voex/editor-schema';
export type CollaborationAccess = 'workspace' | 'share' | 'recent';
export interface CollaborationUser {
  id: string;
  name: string;
  color: string;
  avator?: string;
}
export interface CollaborationTicket {
  enabled: boolean;
  content_mode: 'legacy' | 'collab';
  ticket?: string;
  file_key: string;
  document_name: string;
  ws_url: string;
  permissions: DocumentPermissions;
  user: CollaborationUser;
  expires_at: string;
  schema_version: string;
  epoch: number;
}
export interface CollaborationTarget {
  fileKey: string;
  access: CollaborationAccess;
  shareToken?: string;
  contentMode?: 'legacy' | 'collab';
}

// Go caps collaboration grants at the current access token's expiry.
// Refresh before the server's two-minute renewal window to avoid repeated short grants.
const MIN_ACCESS_VALIDITY = 150_000;

const shareHttp = axios.create({
  baseURL: http.defaults.baseURL,
  timeout: 30000,
  withCredentials: true,
});

export async function getCollaborationTicket(
  target: CollaborationTarget,
  signal?: AbortSignal
): Promise<CollaborationTicket> {
  const body = { file_key: target.fileKey, access: target.access };
  if (target.access !== 'share') {
    if (accessToken.value && accessExpiresAt.value < Date.now() + MIN_ACCESS_VALIDITY)
      await refreshSession();
    signal?.throwIfAborted();
    return http.post<unknown, CollaborationTicket>('/collab/ticket', body, {
      signal,
      timeout: 10000,
    });
  }
  await restoreOptionalShareSession();
  signal?.throwIfAborted();
  const { data } = await shareHttp.post<CollaborationTicket>('/collab/ticket', body, {
    signal,
    timeout: 10000,
    headers: {
      'X-Share-Token': target.shareToken ?? '',
      ...(accessToken.value && accessExpiresAt.value > Date.now()
        ? { Authorization: `Bearer ${accessToken.value}` }
        : {}),
    },
  });
  return data;
}
