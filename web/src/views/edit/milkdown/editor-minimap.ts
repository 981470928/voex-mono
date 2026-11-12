import type { MinimapPlaceholderRule } from '@/plugins/document-minimap';

// Editor-specific DOM knowledge stays outside the reusable minimap engine.
// 编辑器专用的 DOM 处理逻辑放在可复用的缩略图引擎之外。
export const editorMinimapPlaceholders: MinimapPlaceholderRule[] = [
  { selector: '.milkdown-table-block', kind: 'table' },
  { selector: '.milkdown-editor__code-block, .milkdown-code-block', kind: 'code' },
  { selector: '.milkdown-editor__image', kind: 'image' },
  { selector: '.milkdown-attachment', kind: 'attachment' },
  {
    selector: '.milkdown-latex, .milkdown-mermaid, .katex, .mermaid',
    kind: 'diagram',
  },
];

export const editorMinimapIgnoreSelectors = [
  '.milkdown-editor__table-controls',
  '.column-resize-handle',
  '.milkdown-editor__image-controls',
  '.milkdown-editor__image-handle',
  '.ProseMirror-gapcursor',
  '.ProseMirror-widget',
  '[data-minimap-ignore]',
];
