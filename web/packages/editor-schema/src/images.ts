import { parseFragment } from 'parse5';
import { remarkCtx, remarkPluginsCtx } from '@milkdown/kit/core';
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { MarkdownNode, RemarkPlugin } from '@milkdown/kit/transformer';
import { imageAttachmentHash } from '../../../src/views/edit/milkdown/image-import';
export const MIN_WIDTH = 16;
export const MAX_WIDTH = 10000;
let fragmentId = 0;
export type ImageAlignment = 'left' | 'center' | 'right';
export const ALIGNMENT_STYLES: Record<ImageAlignment, string> = {
  left: 'display: block; margin-left: 0; margin-right: auto;',
  center: 'display: block; margin-left: auto; margin-right: auto;',
  right: 'display: block; margin-left: auto; margin-right: 0;',
};

export function parseAlignment(value: unknown): ImageAlignment | null {
  return value === 'left' || value === 'center' || value === 'right' ? value : null;
}

type ImageMarkdownNode = MarkdownNode & {
  url?: string;
  alt?: string;
  title?: string;
  width?: number | null;
  alignment?: ImageAlignment | null;
};

interface ImageAttrs {
  src: string;
  alt: string;
  title: string;
  width: number | null;
  alignment: ImageAlignment | null;
}

export function parseWidth(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const width = Number(value);
  return Number.isInteger(width) && width >= MIN_WIDTH && width <= MAX_WIDTH ? width : null;
}

export function safeImageSource(src: string): boolean {
  if (imageAttachmentHash(src)) return true;
  if (
    !src.trim() ||
    Array.from(src).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    )
  )
    return false;
  if (/^data:/i.test(src)) return /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(src);
  try {
    return ['http:', 'https:', 'blob:'].includes(new URL(src, 'https://voex.local/').protocol);
  } catch {
    return false;
  }
}

export function readImage(element: HTMLImageElement): ImageAttrs | null {
  const src = element.getAttribute('src') ?? '';
  if (!safeImageSource(src)) return null;
  return {
    src,
    alt: element.getAttribute('alt') ?? '',
    title: element.getAttribute('title') ?? '',
    width: parseWidth(element.getAttribute('width')),
    alignment: parseAlignment(element.getAttribute('data-align')),
  };
}

function escapeAttribute(value: string): string {
  return value.replace(
    /[&<>"\r\n]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        '\r': '&#13;',
        '\n': '&#10;',
      })[character]!
  );
}

export function imageLayoutAttrs(node: ProseMirrorNode) {
  const width = parseWidth(node.attrs.width);
  const alignment = parseAlignment(node.attrs.alignment);
  return {
    ...(width !== null && { width }),
    ...(alignment && { 'data-align': alignment, style: ALIGNMENT_STYLES[alignment] }),
  };
}

export function serializeImage(node: ProseMirrorNode): string {
  const layout = Object.entries(imageLayoutAttrs(node))
    .map(([key, value]) => ` ${key}="${escapeAttribute(String(value))}"`)
    .join('');
  return `<img src="${escapeAttribute(node.attrs.src)}" alt="${escapeAttribute(node.attrs.alt)}" title="${escapeAttribute(node.attrs.title)}"${layout}>`;
}

// template 的内容不挂入页面；只读取图片属性，绝不渲染任意 HTML。
function parseImageFragment(value: string, ctx: Ctx): MarkdownNode[] | null {
  const children = parseFragment(value).childNodes;
  if (!children.every((child) => child.nodeName === '#text' || child.nodeName === 'img'))
    return null;
  const images = children
    .filter((child) => child.nodeName === 'img')
    .map((child) => {
      if (!('attrs' in child)) return null;
      const attrs = Object.fromEntries(
        child.attrs.map((attribute) => [attribute.name, attribute.value])
      );
      const src = attrs.src ?? '';
      if (!safeImageSource(src)) return null;
      return {
        src,
        alt: attrs.alt ?? '',
        title: attrs.title ?? '',
        width: parseWidth(attrs.width),
        alignment: parseAlignment(attrs['data-align']),
      };
    });
  if (!images.length || images.some((image) => !image)) return null;
  const prefix = `voex-image-fragment-${++fragmentId}:`;
  let index = 0;
  const markdown = value.replace(
    /<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,
    () => `![image](${prefix}${index++})`
  );
  if (index !== images.length) return null;
  const tree = ctx.get(remarkCtx).parse(markdown) as MarkdownNode;
  const restore = (parent: MarkdownNode) => {
    // 片段内 offset 不对应原始文档，不能交给后续按原文位置处理的插件。
    delete parent.position;
    parent.children = parent.children?.map((child) => {
      delete child.position;
      const image = child as ImageMarkdownNode;
      if (image.type === 'image' && image.url?.startsWith(prefix)) {
        const attrs = images[Number(image.url.slice(prefix.length))];
        if (attrs)
          return {
            ...image,
            url: attrs.src,
            alt: attrs.alt,
            title: attrs.title,
            width: attrs.width,
            alignment: attrs.alignment,
          };
      }
      restore(child);
      return child;
    });
  };
  restore(tree);
  return tree.children ?? null;
}

function restoreImageNodes(parent: MarkdownNode, ctx: Ctx): void {
  if (!parent.children) return;
  parent.children = parent.children.flatMap((child) => {
    // CommonMark 会将独立 HTML 图片包装成段落；多张图片或软换行也要完整恢复。
    const html =
      child.type === 'paragraph' && child.children?.length === 1 ? child.children[0] : child;
    if (html?.type === 'html' && typeof html.value === 'string') {
      const blocks = parseImageFragment(html.value, ctx);
      if (blocks) {
        if (child.type === 'paragraph' || ['root', 'blockquote', 'listItem'].includes(parent.type))
          return blocks;
        if (blocks.every((block) => block.type === 'paragraph'))
          return blocks.flatMap((block) => block.children ?? []);
      }
    }
    restoreImageNodes(child, ctx);
    return [child];
  });
}

export function createImageSchema() {
  const remarkImages: MilkdownPlugin = (ctx) => {
    const plugin: RemarkPlugin<Record<string, unknown>> = {
      plugin: () => (tree) => restoreImageNodes(tree as MarkdownNode, ctx),
      options: {},
    };
    ctx.update(remarkPluginsCtx, (plugins) => [...plugins, plugin]);
    return () => () => {
      ctx.update(remarkPluginsCtx, (plugins) => plugins.filter((item) => item !== plugin));
    };
  };

  function configure(ctx: Ctx) {
    ctx.update(imageSchema.key, (previous) => (schemaCtx) => {
      const schema = previous(schemaCtx);
      return {
        ...schema,
        attrs: {
          ...schema.attrs,
          width: { default: null, validate: 'number|null' },
          alignment: { default: null, validate: 'string|null' },
        },
        parseDOM: [
          {
            tag: 'img[src]',
            getAttrs: (dom) =>
              dom instanceof HTMLImageElement ? (readImage(dom) ?? false) : false,
          },
        ],
        toDOM: (node) => [
          'img',
          {
            src: node.attrs.src,
            alt: node.attrs.alt,
            title: node.attrs.title,
            ...imageLayoutAttrs(node),
          },
        ],
        parseMarkdown: {
          match: schema.parseMarkdown.match,
          runner: (state, markdown, type) => {
            const image = markdown as ImageMarkdownNode;
            state.addNode(type, {
              src: image.url ?? '',
              alt: image.alt ?? '',
              title: image.title ?? '',
              width: parseWidth(image.width),
              alignment: parseAlignment(image.alignment),
            });
          },
        },
        toMarkdown: {
          match: schema.toMarkdown.match,
          runner: (state, node) => {
            const width = parseWidth(node.attrs.width);
            if (width === null && parseAlignment(node.attrs.alignment) === null)
              schema.toMarkdown.runner(state, node);
            else state.addNode('html', undefined, serializeImage(node));
          },
        },
      };
    });
  }
  return { remarkImages, configure };
}
