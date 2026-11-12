import { parseFragment } from 'parse5';
import { $remark } from '@milkdown/kit/utils';
import type { MarkdownNode } from '@milkdown/kit/transformer';
import { DEFAULT_LATEX } from './latex';
import { normalizeHexColor } from './text-color';
import { normalizeFontSize } from './font-size';

type InlineStyle =
  { type: 'textColor' | 'highlight'; color: string } | { type: 'fontSize'; size: number };

/** Only styles produced by portable Markdown export are interpreted. No HTML is rendered. / 仅解析可移植 Markdown 导出产生的样式，不渲染 HTML。 */
function spanStyles(value: string): InlineStyle[] | null {
  if (!/^<span\s[^<>]*>$/i.test(value)) return null;
  const fragment = parseFragment(value + '</span>');
  const element = fragment.childNodes[0];
  if (!element || !('tagName' in element) || element.tagName !== 'span') return null;
  if (element.attrs.length !== 1 || element.attrs[0]?.name !== 'style') return null;
  const result: InlineStyle[] = [];
  for (const declaration of element.attrs[0].value.split(';')) {
    if (!declaration.trim()) continue;
    const separator = declaration.indexOf(':');
    if (separator < 0) return null;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const input = declaration.slice(separator + 1).trim();
    if (property === 'color' || property === 'background-color') {
      const color = normalizeHexColor(input);
      if (!color) return null;
      result.push({ type: property === 'color' ? 'textColor' : 'highlight', color });
    } else if (property === 'font-size') {
      const match = /^(\d+(?:\.\d+)?)px$/i.exec(input);
      const size = match && normalizeFontSize(match[1]);
      if (size === null || !match) return null;
      result.push({ type: 'fontSize', size: Number(size) });
    } else return null;
  }
  return result.length ? result : null;
}

function wrap(node: MarkdownNode, scopes: InlineStyle[][]): MarkdownNode {
  let result = node;
  const styles = new Map<string, InlineStyle>();
  for (const scope of scopes) for (const style of scope) styles.set(style.type, style);
  for (const style of [...styles.values()].reverse()) result = { ...style, children: [result] };
  return result;
}

function inlineStyles(parent: MarkdownNode, inherited: InlineStyle[][] = []): void {
  if (!parent.children || ['code', 'inlineCode', 'voex_latex'].includes(parent.type)) return;
  // Scopes are local to a Markdown inline container; an unclosed HTML tag cannot style later blocks.
  // 作用域仅限当前 Markdown 内联容器；未闭合的 HTML 标签不能影响后续块的样式。
  const isInline = [
    'paragraph',
    'heading',
    'tableCell',
    'strong',
    'emphasis',
    'delete',
    'link',
  ].includes(parent.type);
  const scopes = [...inherited];
  const result: MarkdownNode[] = [];
  for (const child of parent.children) {
    if (isInline && child.type === 'html' && typeof child.value === 'string') {
      const styles = spanStyles(child.value);
      if (styles) {
        scopes.push(styles);
        continue;
      }
      if (/^<\/span\s*>$/i.test(child.value) && scopes.length > inherited.length) {
        scopes.pop();
        continue;
      }
      if (/^<br\s*\/?>$/i.test(child.value)) {
        result.push(wrap({ type: 'break' }, scopes));
        continue;
      }
    }
    inlineStyles(child);
    result.push(wrap(child, scopes));
  }
  parent.children = result;
}

function raw(node: MarkdownNode, source: string, ending?: number): string {
  const start = node.position?.start.offset;
  const end = ending ?? node.position?.end.offset;
  if (start === undefined || end === undefined) return '';
  // Source offsets retain Markdown container prefixes on continuation lines.
  // 源文本偏移量会保留续行中的 Markdown 容器前缀。
  // Strip only the container-width prefix, retaining formula indentation after it.
  // 仅移除与容器宽度对应的前缀，保留其后的公式缩进。
  const width = Math.max(0, (node.position?.start.column ?? 1) - 1);
  const prefix = new RegExp('^[ \\t>]{0,' + width + '}');
  return source
    .slice(start, end)
    .split('\n')
    .map((line, index) => (index ? line.replace(prefix, '') : line))
    .join('\n')
    .trim();
}

function blockMath(parent: MarkdownNode, source: string): void {
  if (!parent.children || ['code', 'inlineCode', 'html'].includes(parent.type)) return;
  const result: MarkdownNode[] = [];
  for (let index = 0; index < parent.children.length; index++) {
    const child = parent.children[index]!;
    const value = raw(child, source);
    if (child.type === 'paragraph' && value.startsWith('$$')) {
      let code: string | undefined;
      let last = index;
      if (value.length > 4 && value.endsWith('$$')) code = value.slice(2, -2).trim();
      else if (value === '$$' || value.startsWith('$$\n') || value.startsWith('$$\r\n')) {
        for (let end = index + 1; end < parent.children.length; end++) {
          const next = parent.children[end]!;
          const ending = raw(next, source);
          if (next.type === 'paragraph' && (ending === '$$' || /\r?\n\$\$$/.test(ending))) {
            const startOffset = child.position?.start.offset;
            const endOffset = next.position?.end.offset;
            if (startOffset !== undefined && endOffset !== undefined) {
              code = raw(child, source, endOffset).slice(2, -2).trim();
              last = end;
            }
            break;
          }
          // Do not swallow another fenced block or a new math opener into a broken formula.
          // 不要将其他围栏代码块或新的数学公式起始标记吞入不完整的公式。
          if (next.type === 'code' || ending.startsWith('$$')) break;
        }
      }
      if (code) {
        result.push({ type: 'voex_latex', ...DEFAULT_LATEX, code });
        index = last;
        continue;
      }
    }
    blockMath(child, source);
    result.push(child);
  }
  parent.children = result;
}

export const portableImportRemark = $remark('voex-portable-import', () => () => (tree, file) => {
  blockMath(tree as MarkdownNode, String(file));
  inlineStyles(tree as MarkdownNode);
});
