import { Editor, editorViewOptionsCtx, parserCtx, rootCtx, schemaCtx } from '@milkdown/kit/core';
import { commonmark, sanitizeLinkHref } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { DOMSerializer } from '@milkdown/kit/prose/model';

export interface AIMessageRenderer {
  render: (markdown: string) => DocumentFragment;
  destroy: () => Promise<void>;
}

// One detached, read-only Milkdown instance per panel supplies the parser/schema.
// Messages receive static DOM, without an EditorView or editor plugins of their own.
export async function createAIMessageRenderer(): Promise<AIMessageRenderer> {
  const root = document.createElement('div');
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.update(editorViewOptionsCtx, (options) => ({ ...options, editable: () => false }));
    })
    .use(commonmark)
    .use(gfm);
  await editor.create();
  const render = editor.action((ctx) => {
    const parse = ctx.get(parserCtx);
    const base = DOMSerializer.fromSchema(ctx.get(schemaCtx));
    const serializer = new DOMSerializer(
      {
        ...base.nodes,
        // Chat only needs text formatting; do not request model-supplied image URLs.
        image: (node) => ['span', {}, node.attrs.alt || node.attrs.title || '图片'],
        // Avoid duplicate document heading IDs across independent messages.
        heading: (node) => [`h${node.attrs.level}`, 0],
        code_block: () => ['pre', { tabindex: '0', 'aria-label': '代码，可横向滚动' }, ['code', 0]],
        table: () => [
          'div',
          { class: 'ai-markdown__table', tabindex: '0', 'aria-label': '表格，可横向滚动' },
          ['table', 0],
        ],
        list_item: (node) =>
          typeof node.attrs.checked === 'boolean'
            ? [
                'li',
                { class: 'ai-markdown__task' },
                [
                  'span',
                  { 'aria-label': node.attrs.checked ? '已完成' : '未完成' },
                  node.attrs.checked ? '☑' : '☐',
                ],
                ['div', 0],
              ]
            : ['li', 0],
      },
      {
        ...base.marks,
        link: (mark) => {
          const href = sanitizeLinkHref(mark.attrs.href);
          try {
            const url = new URL(href, document.baseURI);
            if (href && ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol))
              return [
                'a',
                {
                  href: url.href,
                  title: mark.attrs.title,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                },
                0,
              ];
          } catch {
            // Malformed and unsafe URLs remain readable text.
          }
          return ['span', 0];
        },
      }
    );
    return (markdown: string) => {
      const fragment = document.createDocumentFragment();
      serializer.serializeFragment(parse(markdown).content, { document }, fragment);
      return fragment;
    };
  });
  return {
    render,
    destroy: async () => {
      await editor.destroy();
      root.replaceChildren();
    },
  };
}
