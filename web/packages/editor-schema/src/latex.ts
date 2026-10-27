import type { MarkdownNode } from '@milkdown/kit/transformer';
import { $node, $remark } from '@milkdown/kit/utils';
export const LATEX_NODE_ID = 'voex_latex';
export interface LatexAttrs {
  code: string;
  color: string;
  height: number;
  size: number;
}
export const DEFAULT_LATEX: LatexAttrs = { code: '', color: '#333333', height: 160, size: 32 };
export const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;

export function readLatexAttrs(value: unknown): LatexAttrs | null {
  if (!value || typeof value !== 'object') return null;
  const attrs = value as Record<string, unknown>;
  if (
    typeof attrs.code !== 'string' ||
    !attrs.code.trim() ||
    typeof attrs.color !== 'string' ||
    !HEX_COLOR.test(attrs.color) ||
    typeof attrs.height !== 'number' ||
    !Number.isSafeInteger(attrs.height) ||
    attrs.height < 1 ||
    typeof attrs.size !== 'number' ||
    !Number.isInteger(attrs.size) ||
    attrs.size < 1 ||
    attrs.size > 999
  )
    return null;
  return { code: attrs.code, color: attrs.color, height: attrs.height, size: attrs.size };
}

function serializeLatex(attrs: LatexAttrs): string {
  const { code, ...styles } = attrs;
  return `[${JSON.stringify(styles)}]latex(${JSON.stringify(code)})`;
}

function parseLatex(value: string): LatexAttrs | null {
  const raw = value.trim();
  if (!raw.startsWith('[{') || !raw.endsWith(')')) return null;
  // 分隔点右侧必须为一个完整 JSON 字符串，源码中的引号、反斜杠和换行不会丢失。
  const boundary = raw.indexOf(']latex(');
  if (boundary < 0) return null;
  try {
    const styles: unknown = JSON.parse(raw.slice(1, boundary));
    const code: unknown = JSON.parse(raw.slice(boundary + 7, -1));
    if (!styles || typeof styles !== 'object' || Array.isArray(styles)) return null;
    return readLatexAttrs({ ...DEFAULT_LATEX, ...styles, code });
  } catch {
    return null;
  }
}

function transformLatex(node: MarkdownNode, source: string): void {
  if (!node.children || ['code', 'inlineCode'].includes(node.type)) return;
  node.children = node.children.map((child) => {
    if (child.type === 'paragraph') {
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      // 使用原始 Markdown，避免 CommonMark 先消耗 LaTeX 的反斜杠或下划线。
      const attrs =
        start !== undefined && end !== undefined ? parseLatex(source.slice(start, end)) : null;
      if (attrs) return { type: LATEX_NODE_ID, ...attrs };
    }
    transformLatex(child, source);
    return child;
  });
}

export function createLatexSchema() {
  const remarkLatex = $remark('voex-remark-latex', () => () => (tree, file) => {
    transformLatex(tree as MarkdownNode, String(file));
  });
  const latexNode = $node(LATEX_NODE_ID, () => ({
    group: 'block',
    atom: true,
    isolating: true,
    selectable: true,
    draggable: true,
    attrs: {
      code: { default: '', validate: 'string' },
      color: { default: DEFAULT_LATEX.color, validate: 'string' },
      height: { default: DEFAULT_LATEX.height, validate: 'number' },
      size: { default: DEFAULT_LATEX.size, validate: 'number' },
    },
    leafText: (node) => serializeLatex(node.attrs as LatexAttrs),
    parseDOM: [
      {
        tag: `div[data-type="${LATEX_NODE_ID}"]`,
        getAttrs: (dom) => {
          try {
            return readLatexAttrs(JSON.parse(dom.getAttribute('data-latex') ?? '')) ?? false;
          } catch {
            return false;
          }
        },
      },
    ],
    toDOM: (node) => [
      'div',
      { 'data-type': LATEX_NODE_ID, 'data-latex': JSON.stringify(node.attrs) },
      node.attrs.code as string,
    ],
    parseMarkdown: {
      match: (node) => node.type === LATEX_NODE_ID,
      runner: (state, node, type) => {
        const attrs = readLatexAttrs(node);
        if (attrs) state.addNode(type, attrs);
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === LATEX_NODE_ID,
      runner: (state, node) =>
        state.addNode('html', undefined, serializeLatex(node.attrs as LatexAttrs)),
    },
  }));
  return { remarkLatex, latexNode };
}
