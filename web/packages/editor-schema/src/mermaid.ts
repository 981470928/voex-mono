import type { MarkdownNode } from '@milkdown/kit/transformer';
import { $node, $remark } from '@milkdown/kit/utils';
export const MERMAID_NODE_ID = 'voex_mermaid';
export const DEFAULT_MERMAID_CODE = `flowchart TD
  A[开始] --> B{是否通过}
  B -->|是| C[完成]
  B -->|否| D[修改]
  D --> B`;

function transformMermaid(node: MarkdownNode): void {
  if (
    node.type === 'code' &&
    typeof node.lang === 'string' &&
    node.lang.toLowerCase() === 'mermaid'
  ) {
    node.type = MERMAID_NODE_ID;
    return;
  }
  node.children?.forEach(transformMermaid);
}

function serializeMermaid(code: string): string {
  let length = 3;
  for (const match of code.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}mermaid\n${code}\n${fence}`;
}

export function createMermaidSchema() {
  const remarkMermaid = $remark('voex-remark-mermaid', () => () => (tree) => {
    // 先改 AST 类型，避免 commonmark 的 code_block 抢先消费 mermaid fenced code。
    transformMermaid(tree as MarkdownNode);
  });
  const mermaidNode = $node(MERMAID_NODE_ID, () => ({
    group: 'block',
    atom: true,
    isolating: true,
    selectable: true,
    draggable: true,
    attrs: { code: { default: '', validate: 'string' } },
    leafText: (node) => serializeMermaid(node.attrs.code as string),
    parseDOM: [
      {
        tag: 'pre',
        priority: 60,
        preserveWhitespace: 'full',
        getAttrs: (dom) => {
          const code = dom.querySelector('code');
          if (
            dom.dataset.type !== MERMAID_NODE_ID &&
            dom.dataset.language?.toLowerCase() !== 'mermaid' &&
            !code?.classList.contains('language-mermaid')
          )
            return false;
          return { code: dom.getAttribute('data-mermaid') ?? code?.textContent ?? dom.textContent };
        },
      },
    ],
    toDOM: (node) => [
      'pre',
      {
        'data-type': MERMAID_NODE_ID,
        'data-language': 'mermaid',
        'data-mermaid': node.attrs.code as string,
      },
      ['code', { class: 'language-mermaid' }, node.attrs.code as string],
    ],
    parseMarkdown: {
      match: (node) => node.type === MERMAID_NODE_ID,
      runner: (state, node, type) => state.addNode(type, { code: node.value ?? '' }),
    },
    toMarkdown: {
      match: (node) => node.type.name === MERMAID_NODE_ID,
      runner: (state, node) =>
        state.addNode('code', undefined, node.attrs.code as string, { lang: 'mermaid' }),
    },
  }));
  return { remarkMermaid, mermaidNode };
}
