import type { AgentDraft } from './draft';
import type { AgentToolRegistry } from './registry';

interface DocumentRead {
  fileKey: string;
  version: number;
  content: string;
  summary: string;
  mode: 'full' | 'summary';
}

export class DocumentContext {
  private active?: DocumentRead;
  private version = 0;
  private presentedVersion = 0;

  constructor(
    private readonly draft: AgentDraft,
    registry: AgentToolRegistry
  ) {
    registry.register({
      name: 'read_document',
      description:
        'Read the latest Markdown of the current file or a draft created in this turn. Each read replaces the previous document context and requests a fresh internal summary.',
      parameters: {
        type: 'object',
        properties: {
          file_key: {
            type: 'string',
            description:
              'Defaults to the current file. Use the draft ID to read a newly created file.',
          },
        },
        required: [],
        additionalProperties: false,
      },
      execute: (input) => {
        const fileKey =
          typeof input.file_key === 'string' ? input.file_key : this.draft.source.file_key;
        const content = this.draft.read(fileKey);
        this.active = { fileKey, content, version: ++this.version, summary: '', mode: 'full' };
        return { file_key: fileKey, version: this.version };
      },
    });
    registry.register({
      name: 'set_document_context',
      description:
        'Save a short internal summary for the version just read. Choose summary for subsequent requests, or full when exact wording is needed. To switch modes on an already summarized version, omit summary.',
      parameters: {
        type: 'object',
        properties: {
          version: {
            type: 'integer',
            minimum: 1,
            description: 'Version shown in the current document context.',
          },
          mode: { type: 'string', enum: ['summary', 'full'] },
          summary: {
            type: 'string',
            description:
              'Requested after each read. Summarize the subject, structure and task-relevant facts in at most 800 characters. Write in the user’s language.',
          },
        },
        required: ['version', 'mode'],
        additionalProperties: false,
      },
      execute: (input) => {
        const active = this.current();
        if (!active || input.version !== active.version || this.presentedVersion !== active.version)
          return {
            status: 'summary_not_updated',
            detail: 'Use the version from the latest document snapshot.',
          };
        const summary = typeof input.summary === 'string' ? input.summary.trim() : active.summary;
        if (!summary || Array.from(summary).length > 800)
          return {
            file_key: active.fileKey,
            version: active.version,
            mode: active.mode,
            status: 'summary_not_updated',
            detail: 'Send a concise summary of 1–800 characters when available.',
          };
        active.summary = summary;
        active.mode = input.mode === 'full' ? 'full' : 'summary';
        return { file_key: active.fileKey, version: active.version, mode: active.mode };
      },
    });
  }

  private current() {
    const active = this.active;
    if (!active) return undefined;
    const content = this.draft.read(active.fileKey);
    if (content !== active.content) {
      this.active = {
        fileKey: active.fileKey,
        version: ++this.version,
        content,
        summary: '',
        mode: 'full',
      };
    }
    return this.active;
  }

  snapshot(forRequest: boolean) {
    const active = this.current();
    if (!active) return undefined;
    if (forRequest) this.presentedVersion = active.version;
    return {
      file_key: active.fileKey,
      version: active.version,
      ...(active.mode === 'full'
        ? { content: active.content, summary_requested: !active.summary }
        : { summary: active.summary }),
    };
  }
}
