import type { RouteLocationRaw } from 'vue-router';

export interface FileListEntry {
  key: string;
  kind: 'folder' | 'document';
  name: string;
  typeLabel: string;
  updated_at: string;
  location?: RouteLocationRaw;
  description?: string;
}
