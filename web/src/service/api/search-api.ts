import http from './https';
import type { ApiError } from './index';

export interface SearchCreator {
  id: string | null;
  name: string | null;
  avator: string | null;
}

// SearchHit 与后端 searchDocumentDTO 一一对应；snippet 为命中处正文摘录，不含完整正文。
export interface SearchHit {
  id: number;
  file_key: string;
  file_name: string;
  project_key: string;
  project_name: string;
  folder_key: string;
  folder_name: string;
  team_key: string;
  creator: SearchCreator;
  created_at: string;
  updated_at: string;
  revision: number;
  snippet: string;
  score: number;
}

export interface SearchResult {
  items: SearchHit[];
  total: number;
}

export interface SearchDocumentsParams {
  q: string;
  team_key?: string;
  limit?: number;
  offset?: number;
}

export function searchDocuments(params: SearchDocumentsParams, signal?: AbortSignal) {
  return http.get<ApiError, SearchResult>('/search', { params, signal });
}
