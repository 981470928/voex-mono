import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import { SerializerReady, serializerCtx, schemaCtx, remarkCtx } from '@milkdown/kit/core';
import { headingSchema, paragraphSchema, sanitizeLinkHref } from '@milkdown/kit/preset/commonmark';
import type { Fragment, Mark, Node as ProseNode } from '@milkdown/kit/prose/model';
import { SerializerState, type MarkdownNode, type NodeSchema } from '@milkdown/kit/transformer';
import { $remark } from '@milkdown/kit/utils';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { normalizeHexColor } from './text-color';
import { normalizeFontSize } from './font-size';
import { imageLayoutAttrs, parseAlignment, parseWidth, safeImageSource } from './images';

type HtmlNode = DefaultTreeAdapterMap['childNode'];
type HtmlElement = DefaultTreeAdapterMap['element'];
type MarkData = { type: string; [key: string]: unknown };
const RICH_OPEN = '<span data-voex-rich="1">';
const STYLE_MARKS = new Set(['textColor', 'highlight', 'fontSize']);

function escape(value: unknown, text = false): string {
  const string = String(value ?? '');
  return string.replace(
    text ? /[&<>"'\r\n|*_`~[\]\\]/g : /[&<>"'\r\n|]/g,
    (char) => `&#${char.charCodeAt(0)};`
  );
}

function wrapMark(mark: Mark, content: string): string {
  switch (mark.type.name) {
    case 'strong':
      return `<strong data-marker="${mark.attrs.marker === '_' ? '_' : '*'}">${content}</strong>`;
    case 'emphasis':
      return `<em data-marker="${mark.attrs.marker === '_' ? '_' : '*'}">${content}</em>`;
    case 'strike_through':
      return `<s>${content}</s>`;
    case 'inlineCode':
      return `<code>${content}</code>`;
    case 'link': {
      const href = sanitizeLinkHref(mark.attrs.href);
      if (!href) throw new Error('富文本包含不安全的链接');
      return `<a href="${escape(href)}"${mark.attrs.title === null ? '' : ` title="${escape(mark.attrs.title)}"`}>${content}</a>`;
    }
    case 'textColor':
    case 'highlight': {
      const color = normalizeHexColor(mark.attrs.color);
      if (!color) throw new Error('富文本颜色无效');
      const foreground = mark.type.name === 'textColor';
      return `<span ${foreground ? 'data-voex-text-color' : 'data-voex-highlight'}="${color}" style="${foreground ? 'color' : 'background-color'}: ${color}">${content}</span>`;
    }
    case 'fontSize': {
      const size = normalizeFontSize(mark.attrs.size);
      if (size === null) throw new Error('富文本字号无效');
      return `<span data-voex-font-size="${size}" style="font-size: ${size}px">${content}</span>`;
    }
    default:
      throw new Error(`不支持序列化的富文本格式：${mark.type.name}`);
  }
}

function serializeInline(node: ProseNode): string {
  let content: string;
  if (node.isText) content = escape(node.text, true);
  else if (node.type.name === 'hardbreak')
    content = `<br data-is-inline="${node.attrs.isInline ? 'true' : 'false'}">`;
  else if (node.type.name === 'html')
    content = `<span data-voex-html="1">${escape(node.attrs.value, true)}</span>`;
  else if (node.type.name === 'footnote_reference')
    content = `<span data-voex-footnote="1">${escape(node.attrs.label, true)}</span>`;
  else if (node.type.name === 'voex_emoji')
    content = `<span data-voex-emoji="${escape(node.attrs.char)}">${escape(node.attrs.char, true)}</span>`;
  else if (node.type.name === 'image') {
    if (!safeImageSource(String(node.attrs.src))) throw new Error('富文本图片地址无效');
    const layout = Object.entries(imageLayoutAttrs(node))
      .map(([key, value]) => ` ${key}="${escape(value)}"`)
      .join('');
    content = `<img src="${escape(node.attrs.src)}" alt="${escape(node.attrs.alt)}" title="${escape(node.attrs.title)}"${layout}>`;
  } else throw new Error(`不支持序列化的行内组件：${node.type.name}`);
  const code = node.marks.find((mark) => mark.type.name === 'inlineCode');
  if (code) {
    if (!node.isText) throw new Error('行内代码只能包含文字');
    content = wrapMark(code, content);
  }
  for (const mark of [...node.marks].reverse())
    if (mark.type.name !== 'inlineCode') content = wrapMark(mark, content);
  return content;
}

function serializeRichContent(content: Fragment): string {
  const html: string[] = [];
  content.forEach((node) => html.push(serializeInline(node)));
  return `${RICH_OPEN}${html.join('')}</span>`;
}

/** Inline HTML is emitted as one unit. Markdown delimiters never cross a style tag. */
export function withRichInlineSerialization(base: NodeSchema): NodeSchema {
  return {
    ...base,
    toMarkdown: {
      ...base.toMarkdown,
      runner(state, node) {
        let rich = false;
        node.content.forEach((child) => {
          if (child.marks.some((mark) => STYLE_MARKS.has(mark.type.name))) rich = true;
        });
        if (!rich) return base.toMarkdown.runner(state, node);
        const html = serializeRichContent(node.content);
        if (node.type.name === 'heading')
          state.openNode('heading', undefined, { depth: node.attrs.level });
        else state.openNode('paragraph');
        state.addNode('html', undefined, html);
        state.closeNode();
      },
    },
  };
}

function attributes(element: HtmlElement, allowed: string[]): Record<string, string> {
  if (element.attrs.some(({ name }) => !allowed.includes(name)))
    throw new Error('不支持的富文本属性');
  return Object.fromEntries(element.attrs.map(({ name, value }) => [name, value]));
}

function marked(node: MarkdownNode, marks: Map<string, MarkData>): MarkdownNode {
  let result = node;
  for (const mark of [...marks.values()].reverse())
    result = { ...mark, children: [result] } as MarkdownNode;
  return result;
}

function children(element: HtmlElement, marks: Map<string, MarkData>): MarkdownNode[] {
  return element.childNodes.flatMap((child) => convert(child, marks));
}

function plainText(element: HtmlElement): string {
  if (element.childNodes.some((child) => child.nodeName !== '#text'))
    throw new Error('行内内容只能包含文字');
  return element.childNodes.map((child) => ('value' in child ? child.value : '')).join('');
}

function convert(node: HtmlNode, inherited: Map<string, MarkData>): MarkdownNode[] {
  if (node.nodeName === '#text' && 'value' in node)
    return node.value ? [marked({ type: 'text', value: node.value }, inherited)] : [];
  if (!('tagName' in node)) throw new Error('不支持的富文本节点');
  const marks = new Map(inherited);
  switch (node.tagName) {
    case 'strong':
    case 'em': {
      const attrs = attributes(node, ['data-marker']);
      const type = node.tagName === 'strong' ? 'strong' : 'emphasis';
      marks.set(type, { type, marker: attrs['data-marker'] === '_' ? '_' : '*' });
      return children(node, marks);
    }
    case 's':
      attributes(node, []);
      marks.set('delete', { type: 'delete' });
      return children(node, marks);
    case 'a': {
      const attrs = attributes(node, ['href', 'title']);
      const href = sanitizeLinkHref(attrs.href);
      if (!href) throw new Error('不安全的富文本链接');
      marks.set('link', { type: 'link', url: href, title: attrs.title ?? null });
      return children(node, marks);
    }
    case 'code':
      attributes(node, []);
      return [marked({ type: 'inlineCode', value: plainText(node) }, marks)];
    case 'br': {
      const attrs = attributes(node, ['data-is-inline']);
      if (!['true', 'false'].includes(attrs['data-is-inline'] ?? ''))
        throw new Error('无效的富文本换行');
      return [
        marked({ type: 'break', data: { isInline: attrs['data-is-inline'] === 'true' } }, marks),
      ];
    }
    case 'img': {
      const attrs = attributes(node, ['src', 'alt', 'title', 'width', 'data-align', 'style']);
      if (!safeImageSource(attrs.src ?? '')) throw new Error('不安全的富文本图片');
      return [
        marked(
          {
            type: 'image',
            url: attrs.src,
            alt: attrs.alt ?? '',
            title: attrs.title ?? '',
            width: parseWidth(attrs.width),
            alignment: parseAlignment(attrs['data-align']),
          },
          marks
        ),
      ];
    }
    case 'span': {
      const attrs = attributes(node, [
        'data-voex-text-color',
        'data-voex-highlight',
        'data-voex-font-size',
        'data-voex-emoji',
        'data-voex-html',
        'data-voex-footnote',
        'style',
      ]);
      if (attrs['data-voex-html'] !== undefined || attrs['data-voex-footnote'] !== undefined) {
        if (Object.keys(attrs).length !== 1) throw new Error('无效的富文本叶子节点');
        const value = plainText(node);
        if (attrs['data-voex-html'] === '1') return [marked({ type: 'html', value }, marks)];
        if (attrs['data-voex-footnote'] === '1')
          return [marked({ type: 'footnoteReference', label: value, identifier: value }, marks)];
        throw new Error('无效的富文本叶子节点');
      }
      if (attrs['data-voex-emoji'] !== undefined) {
        if (
          Object.keys(attrs).length !== 1 ||
          !attrs['data-voex-emoji'] ||
          plainText(node) !== attrs['data-voex-emoji']
        )
          throw new Error('无效的富文本表情');
        return [marked({ type: 'voex_emoji', value: attrs['data-voex-emoji'] }, marks)];
      }
      const styleKeys = [
        'data-voex-text-color',
        'data-voex-highlight',
        'data-voex-font-size',
      ].filter((key) => attrs[key] !== undefined);
      if (styleKeys.length !== 1 || Object.keys(attrs).length !== 2)
        throw new Error('无效的富文本样式');
      const key = styleKeys[0]!;
      if (key === 'data-voex-font-size') {
        const size = normalizeFontSize(attrs[key]);
        if (size === null || attrs.style !== `font-size: ${size}px`)
          throw new Error('无效的富文本字号');
        marks.set('fontSize', { type: 'fontSize', size });
      } else {
        const color = normalizeHexColor(attrs[key]);
        const kind = key === 'data-voex-text-color' ? 'textColor' : 'highlight';
        if (
          !color ||
          attrs.style !== `${kind === 'textColor' ? 'color' : 'background-color'}: ${color}`
        )
          throw new Error('无效的富文本颜色');
        marks.set(kind, { type: kind, color });
      }
      return children(node, marks);
    }
    default:
      throw new Error('不支持的富文本标签');
  }
}

function parseRichHtml(value: string): MarkdownNode[] | null {
  if (!value.startsWith(RICH_OPEN) || !value.endsWith('</span>')) return null;
  try {
    const fragment = parseFragment(value);
    const element = fragment.childNodes[0];
    if (
      fragment.childNodes.length !== 1 ||
      !element ||
      !('tagName' in element) ||
      element.tagName !== 'span'
    )
      return null;
    const attrs = attributes(element, ['data-voex-rich']);
    if (attrs['data-voex-rich'] !== '1') return null;
    return children(element, new Map());
  } catch {
    return null;
  }
}

function richEnd(source: string, start: number): number | null {
  const tags = /<\/?span\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(source); match; match = tags.exec(source)) {
    depth += /^<\//.test(match[0]) ? -1 : 1;
    if (depth === 0) return tags.lastIndex;
  }
  return null;
}

function restoreRichText(parent: MarkdownNode, source: string): void {
  if (!parent.children || ['code', 'inlineCode'].includes(parent.type)) return;
  const result: MarkdownNode[] = [];
  for (let index = 0; index < parent.children.length; index++) {
    const child = parent.children[index]!;
    if (child.type === 'html' && typeof child.value === 'string') {
      const direct = parseRichHtml(child.value.trim());
      if (direct) {
        result.push(
          ...(['root', 'blockquote', 'listItem'].includes(parent.type)
            ? [{ type: 'paragraph', children: direct }]
            : direct)
        );
        continue;
      }
      const start = child.position?.start.offset;
      if (child.value === RICH_OPEN && start !== undefined) {
        const end = richEnd(source, start);
        if (end !== null) {
          let last = index;
          while (
            last < parent.children.length &&
            (parent.children[last]!.position?.end.offset ?? -1) < end
          )
            last++;
          if (parent.children[last]?.position?.end.offset === end) {
            const parsed = parseRichHtml(source.slice(start, end));
            if (parsed) {
              result.push(...parsed);
              index = last;
              continue;
            }
          }
        }
      }
    }
    restoreRichText(child, source);
    result.push(child);
  }
  parent.children = result;
}

export function createRichTextSchema() {
  const serializer: MilkdownPlugin = (ctx) => async () => {
    await ctx.wait(SerializerReady);
    // Listener callbacks may retain this function; each invocation owns a clean stack.
    ctx.set(serializerCtx, (node) =>
      SerializerState.create(ctx.get(schemaCtx), ctx.get(remarkCtx))(node)
    );
  };
  const remarkRichText = $remark('voex-rich-text', () => () => (tree, file) => {
    restoreRichText(tree as MarkdownNode, String(file));
  });
  function configure(ctx: Ctx) {
    for (const node of [paragraphSchema, headingSchema])
      ctx.update(
        node.key,
        (previous) => (schemaCtx) => withRichInlineSerialization(previous(schemaCtx))
      );
  }
  return { plugins: [...remarkRichText], serializer, configure };
}
