import { DocumentContext } from './document-context';
import { registerRichEditorTools } from './rich-editor-tools';
import { AgentToolRegistry } from './registry';
import { AgentDraft } from './draft';
import type { AgentTool, ToolSchema } from './types';

const string = (description: string) => ({ type: 'string' as const, description });
const schema = (properties: ToolSchema['properties'], required: string[]): ToolSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const keyProperty = {
  file_key: string(
    'Defaults to the current file. Alternatively use a draft ID created in this turn.'
  ),
};
const key = (input: Record<string, unknown>) =>
  typeof input.file_key === 'string' ? input.file_key : undefined;

export function registerEditorTools(
  registry: AgentToolRegistry,
  draft: AgentDraft,
  formulaColor = '#333333'
) {
  const tools: AgentTool[] = [
    {
      name: 'replace_text',
      description: 'Replace a unique, exact Markdown fragment in the review draft.',
      parameters: schema(
        {
          ...keyProperty,
          search: string('A complete fragment that matches exactly once.'),
          replacement: string('Replacement Markdown. Use an empty string to delete the match.'),
        },
        ['search', 'replacement']
      ),
      execute: (input) =>
        draft.replace(String(input.search), String(input.replacement), key(input)),
    },
    {
      name: 'append_content',
      description: 'Append Markdown to the end of the review draft.',
      parameters: schema({ ...keyProperty, content: string('Markdown to append.') }, ['content']),
      execute: (input) =>
        draft.write(
          `${draft.read(key(input)).trimEnd()}\n\n${String(input.content)}\n`,
          key(input)
        ),
    },
    {
      name: 'replace_document',
      description:
        'Replace the entire draft only for a requested full rewrite or reformat. Preserve unaffected text and attachment syntax.',
      parameters: schema({ ...keyProperty, content: string('Complete replacement Markdown.') }, [
        'content',
      ]),
      execute: (input) => draft.write(String(input.content), key(input)),
    },
    {
      name: 'insert_special',
      description:
        'Insert an emoji, LaTeX formula or Mermaid diagram directly into the draft. Append when after is omitted.',
      parameters: schema(
        {
          ...keyProperty,
          kind: { type: 'string', enum: ['emoji', 'latex', 'mermaid'] },
          content: string('Unicode emoji, raw LaTeX or Mermaid source without code fences.'),
          after: string('Optional unique Markdown fragment to insert after.'),
        },
        ['kind', 'content']
      ),
      execute: (input) => {
        const content = String(input.content);
        if (!content.trim()) throw new Error('The inserted content cannot be empty.');
        let fragment = content;
        if (input.kind === 'latex')
          fragment = `[${JSON.stringify({ color: /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(formulaColor) ? formulaColor : '#333333', height: 160, size: 32 })}]latex(${JSON.stringify(content)})`;
        if (input.kind === 'mermaid') {
          const fence = '`'.repeat(
            Math.max(3, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length + 1))
          );
          fragment = `${fence}mermaid\n${content}\n${fence}`;
        }
        const separator = input.kind === 'emoji' ? ' ' : '\n\n';
        if (typeof input.after === 'string' && input.after)
          return draft.replace(
            input.after,
            `${input.after}${separator}${fragment}${separator}`,
            key(input)
          );
        return draft.write(
          `${draft.read(key(input)).trimEnd()}${separator}${fragment}\n`,
          key(input)
        );
      },
    },
  ];
  tools.forEach((tool) => registry.register(tool));
  registerRichEditorTools(registry, draft);
  return new DocumentContext(draft, registry);
}

export interface FileCapabilities {
  canCreate: () => boolean;
  canRename: () => boolean;
}

/** Host-owned capabilities are explicitly registered; the core never imports workspace APIs. / 宿主提供的能力必须显式注册；核心不会导入工作区 API。 */
export function registerFileTools(
  registry: AgentToolRegistry,
  draft: AgentDraft,
  host: FileCapabilities
) {
  registry.register({
    name: 'create_file',
    description:
      'Create a review draft in the current folder. Use the returned draft ID for subsequent edits. The file is created when the user applies the review.',
    parameters: schema({ name: string('File name.'), content: string('Initial Markdown.') }, [
      'name',
      'content',
    ]),
    execute: (input) => {
      if (!host.canCreate())
        throw new Error('Permission to create files in this folder is required.');
      const name = String(input.name);
      return { ...draft.create(name, String(input.content)), name };
    },
  });
  registry.register({
    name: 'rename_file',
    description:
      'Rename the current file or a file drafted in this turn. The rename takes effect when the user applies the review.',
    parameters: schema({ ...keyProperty, name: string('New file name.') }, ['name']),
    execute: (input) => {
      if (!host.canRename()) throw new Error('Permission to rename this file is required.');
      const name = String(input.name);
      return { ...draft.rename(name, key(input)), name };
    },
  });
}
