import type { DocumentChange, DocumentSnapshot, ReviewSnapshot } from './types';
import { randomUUID } from '@/utils/id';

/** Isolated working copies. Nothing here receives a live editor or a save function. */
export class AgentDraft {
  private changes = new Map<string, DocumentChange>();

  constructor(readonly source: DocumentSnapshot) {}

  read(key = this.source.file_key): string {
    const change = this.changes.get(key);
    if (change) return change.after_content;
    if (key === this.source.file_key) return this.source.content;
    throw new Error('只能操作当前文档或本轮新建的文档');
  }

  private current(key: string): DocumentChange {
    const existing = this.changes.get(key);
    if (existing) return existing;
    if (key !== this.source.file_key || !this.source.writable)
      throw new Error('当前文档没有编辑权限');
    const change: DocumentChange = {
      kind: 'update',
      file_key: key,
      project_key: this.source.project_key,
      folder_key: this.source.folder_key,
      before_name: this.source.file_name,
      after_name: this.source.file_name,
      before_content: this.source.content,
      after_content: this.source.content,
      revision: this.source.revision,
    };
    this.changes.set(key, change);
    return change;
  }

  write(content: string, key = this.source.file_key) {
    if (new TextEncoder().encode(content).length > 1024 * 1024)
      throw new Error('单个文档不能超过 1 MiB');
    this.current(key).after_content = content;
    return { status: 'pending_review', file_key: key };
  }

  replace(search: string, replacement: string, key = this.source.file_key) {
    const content = this.read(key);
    const index = content.indexOf(search);
    if (!search || index < 0 || content.indexOf(search, index + 1) >= 0)
      throw new Error('待替换内容必须非空且只匹配一次，请读取当前草稿并扩大匹配上下文');
    return this.write(
      content.slice(0, index) + replacement + content.slice(index + search.length),
      key
    );
  }

  create(name: string, content: string): { status: string; file_key: string } {
    if (!name.trim() || Array.from(name.trim()).length > 255)
      throw new Error('文件名称需为 1–255 个字符');
    if (this.changes.size >= 20) throw new Error('一次最多修改 20 个文件');
    if (new TextEncoder().encode(content).length > 1024 * 1024)
      throw new Error('单个文档不能超过 1 MiB');
    const key = `draft-${randomUUID()}`;
    this.changes.set(key, {
      kind: 'create',
      file_key: key,
      project_key: this.source.project_key,
      folder_key: this.source.folder_key,
      before_name: '',
      after_name: name.trim(),
      before_content: '',
      after_content: '',
      revision: 0,
    });
    return this.write(content, key);
  }

  rename(name: string, key = this.source.file_key) {
    if (!name.trim() || Array.from(name.trim()).length > 255)
      throw new Error('文件名称需为 1–255 个字符');
    this.current(key).after_name = name.trim();
    return { status: 'pending_review', file_key: key };
  }

  snapshot(): ReviewSnapshot | undefined {
    const changes = Array.from(this.changes.values()).filter(
      (change) =>
        change.kind === 'create' ||
        change.before_name !== change.after_name ||
        change.before_content !== change.after_content
    );
    if (!changes.length) return;
    // Copy rather than reference the working draft: every chat button owns its snapshot.
    return {
      id: randomUUID(),
      createdAt: Date.now(),
      status: 'pending',
      fileCount: changes.length,
      changes: structuredClone(changes),
    };
  }
}
