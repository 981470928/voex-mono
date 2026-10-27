import type { FolderInfo } from '@/service/api/workspace-api';
import type { DocumentSummary } from '@/service/api/document-api';

export interface DirectoryNode {
  key: string;
  folder?: FolderInfo;
  document?: DocumentSummary;
  children: DirectoryNode[];
}

export function buildDirectoryTree(
  folders: FolderInfo[],
  documents: DocumentSummary[]
): DirectoryNode[] {
  const index = new Map<string, DirectoryNode>(
    folders.map((folder) => [folder.folder_key, { key: folder.folder_key, folder, children: [] }])
  );
  const roots: DirectoryNode[] = [];
  for (const folder of folders) {
    const node = index.get(folder.folder_key)!;
    const parent = folder.parent_key ? index.get(folder.parent_key) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  for (const doc of documents) {
    index.get(doc.folder_key)?.children.push({ key: doc.file_key, document: doc, children: [] });
  }
  return roots;
}

export function folderAncestors(folders: FolderInfo[], key?: string): FolderInfo[] {
  const index = new Map(folders.map((folder) => [folder.folder_key, folder]));
  const path: FolderInfo[] = [];
  const visited = new Set<string>();
  let folder = key ? index.get(key) : undefined;
  while (folder && !visited.has(folder.folder_key)) {
    visited.add(folder.folder_key);
    path.unshift(folder);
    folder = folder.parent_key ? index.get(folder.parent_key) : undefined;
  }
  return path;
}

export function desktopLocation(project_key?: string, folder_key?: string, team_key?: string) {
  const query = team_key ? { team_key } : undefined;
  if (!project_key) return { name: 'recent', query };
  return {
    name: 'project',
    params: { projectId: project_key, folderId: folder_key ?? '' },
    query,
  };
}

export function formatTime(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
