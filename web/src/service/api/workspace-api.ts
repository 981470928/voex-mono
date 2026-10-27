import http from './https';
import type { ApiError } from './index';
import type { DocumentSummary } from './document-api';

export interface ProjectPermissions {
  remove: boolean;
  children_remove: boolean;
  read: boolean;
  write: boolean;
  manage: boolean;
  share?: boolean;
}

export interface ProjectPrivileges {
  mode: 'inherit' | 'restricted';
  user_ids?: string[];
}

export interface ProjectInfo {
  project_key: string;
  team_key: string;
  name: string;
  created_at: string;
  updated_at: string;
  permissions: ProjectPermissions;
  privileges: ProjectPrivileges;
}

export interface FolderInfo {
  folder_key: string;
  project_key: string;
  parent_key: string | null;
  name: string;
  created_at: string;
  updated_at: string;
  privileges?: { mode: 'inherit' };
}

export interface ProjectTree {
  project: ProjectInfo;
  folders: FolderInfo[];
  documents: DocumentSummary[];
}

export function queryProjects(signal?: AbortSignal, teamKey?: string) {
  return http.get<ApiError, ProjectInfo[]>('/projects', { signal, params: { team_key: teamKey } });
}

export function initializeWorkspace(teamKey?: string) {
  return http.post<ApiError, ProjectInfo[]>('/workspace/initialize', { team_key: teamKey });
}

export function getProjectTree(key: string, signal?: AbortSignal) {
  return http.get<ApiError, ProjectTree>(`/project/${encodeURIComponent(key)}/tree`, { signal });
}

export function createProject(name: string, teamKey?: string) {
  return http.post<ApiError, ProjectInfo>('/project', { name, team_key: teamKey });
}

export function getProjectPrivileges(key: string, signal?: AbortSignal) {
  return http.get<ApiError, ProjectPrivileges>(`/project/${encodeURIComponent(key)}/privileges`, {
    signal,
  });
}

export function setProjectPrivileges(key: string, privileges: ProjectPrivileges) {
  return http.put<ApiError, ProjectInfo>(
    `/project/${encodeURIComponent(key)}/privileges`,
    privileges
  );
}

export function renameProject(key: string, name: string) {
  return http.put<ApiError, { success: true }>(`/project/${encodeURIComponent(key)}`, { name });
}

export function deleteProject(key: string, cascade = false) {
  return http.delete<ApiError, { success: true }>(`/project/${encodeURIComponent(key)}`, {
    params: cascade ? { cascade: true } : undefined,
  });
}

export function createFolder(data: {
  project_key: string;
  parent_key: string | null;
  name: string;
}) {
  return http.post<ApiError, FolderInfo>('/folder', data);
}

export function renameFolder(key: string, name: string) {
  return http.put<ApiError, { success: true }>(`/folder/${encodeURIComponent(key)}`, { name });
}

/** 将文件夹移入回收站；cascade=true 时一并隐藏其中正常的文档。 */
export function deleteFolder(key: string, cascade = false) {
  return http.delete<ApiError, { success: true }>(`/folder/${encodeURIComponent(key)}`, {
    params: cascade ? { cascade: true } : undefined,
  });
}
