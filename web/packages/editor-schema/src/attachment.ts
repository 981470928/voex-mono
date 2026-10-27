import { remarkPluginsCtx } from '@milkdown/kit/core';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { MarkdownNode, RemarkPlugin } from '@milkdown/kit/transformer';
import { $node } from '@milkdown/kit/utils';
import { parseWidth, parseAlignment, type ImageAlignment } from './images';
export const ATTACHMENT_NODE_ID = 'attachment';

const ATTACHMENT_TAG_PATTERN =
  /^<voex-attachment data-hash="([^"]*)" data-name="([^"]*)" data-mime="([^"]*)"(?: data-display="(attachment|media)")?(?: data-width="(\d+)")?(?: data-align="(left|center|right)")?><\/voex-attachment>$/;

interface AttachmentAttrs {
  hash: string;
  name: string;
  mime: string;
  display: 'attachment' | 'media' | null;
  width: number | null;
  alignment: ImageAlignment | null;
}

export function attachmentMediaKind(mime: string): 'video' | 'audio' | null {
  if (mime.toLowerCase().startsWith('video/')) return 'video';
  if (mime.toLowerCase().startsWith('audio/')) return 'audio';
  return null;
}

export function isExpandedMedia(node: ProseMirrorNode): boolean {
  return (
    !!attachmentMediaKind(String(node.attrs.mime ?? '')) && node.attrs.display !== 'attachment'
  );
}

type AttachmentMarkdownNode = MarkdownNode & {
  hash?: unknown;
  name?: unknown;
  mime?: unknown;
  display?: unknown;
  width?: unknown;
  alignment?: unknown;
};

function encodeAttribute(value: string): string {
  return encodeURIComponent(value);
}

function decodeAttribute(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function serializeAttachment(attrs: AttachmentAttrs): string {
  const layout = `${attrs.display ? ` data-display="${attrs.display}"` : ''}${attrs.width ? ` data-width="${attrs.width}"` : ''}${attrs.alignment ? ` data-align="${attrs.alignment}"` : ''}`;
  return `<voex-attachment data-hash="${encodeAttribute(attrs.hash)}" data-name="${encodeAttribute(attrs.name)}" data-mime="${encodeAttribute(attrs.mime)}"${layout}></voex-attachment>`;
}

function parseAttachmentTag(value: string): AttachmentAttrs | null {
  const match = value.trim().match(ATTACHMENT_TAG_PATTERN);
  if (!match) return null;

  const hash = decodeAttribute(match[1] ?? '');
  const name = decodeAttribute(match[2] ?? '');
  const mime = decodeAttribute(match[3] ?? '');
  if (!hash || name === null || mime === null) return null;

  const display = match[4] === 'attachment' || match[4] === 'media' ? match[4] : null;
  const width = parseWidth(match[5]);
  const alignment = parseAlignment(match[6]);
  if (match[5] && width === null) return null;
  return { hash, name, mime, display, width, alignment };
}

function getHtmlValue(node: MarkdownNode): string | null {
  if (node.type === 'html' && typeof node.value === 'string') return node.value;

  if (node.type !== 'paragraph' || !node.children?.length) return null;
  if (!node.children.every((child) => child.type === 'html' && typeof child.value === 'string')) {
    return null;
  }
  return node.children.map((child) => child.value as string).join('');
}

function transformAttachmentNodes(node: MarkdownNode): void {
  if (!node.children) return;

  node.children = node.children.map((child) => {
    const htmlValue = getHtmlValue(child);
    const attrs = htmlValue ? parseAttachmentTag(htmlValue) : null;
    if (attrs) {
      return {
        type: ATTACHMENT_NODE_ID,
        ...attrs,
      } as AttachmentMarkdownNode;
    }

    transformAttachmentNodes(child);
    return child;
  });
}

function createRemarkAttachmentPlugin(): MilkdownPlugin {
  return (ctx) => {
    const remarkPlugin: RemarkPlugin<Record<string, unknown>> = {
      plugin: () => (tree) => transformAttachmentNodes(tree as MarkdownNode),
      options: {},
    };
    ctx.update(remarkPluginsCtx, (plugins) => [...plugins, remarkPlugin]);

    return () => {
      return () => {
        ctx.update(remarkPluginsCtx, (plugins) =>
          plugins.filter((plugin) => plugin !== remarkPlugin)
        );
      };
    };
  };
}

export function getNodeAttrs(node: ProseMirrorNode): AttachmentAttrs {
  return {
    hash: typeof node.attrs.hash === 'string' ? node.attrs.hash : '',
    name: typeof node.attrs.name === 'string' ? node.attrs.name : '',
    mime: typeof node.attrs.mime === 'string' ? node.attrs.mime : '',
    display:
      node.attrs.display === 'media' || node.attrs.display === 'attachment'
        ? node.attrs.display
        : null,
    width: parseWidth(node.attrs.width),
    alignment: parseAlignment(node.attrs.alignment),
  };
}

export function createAttachmentSchema() {
  const remarkAttachmentPlugin = createRemarkAttachmentPlugin();
  const attachmentNode = $node(ATTACHMENT_NODE_ID, () => ({
    group: 'block',
    atom: true,
    draggable: true,
    isolating: true,
    selectable: true,
    attrs: {
      hash: { default: '', validate: 'string' },
      name: { default: '', validate: 'string' },
      mime: { default: '', validate: 'string' },
      display: { default: null, validate: 'string|null' },
      width: { default: null, validate: 'number|null' },
      alignment: { default: null, validate: 'string|null' },
    },
    parseDOM: [
      {
        tag: `div[data-type="${ATTACHMENT_NODE_ID}"]`,
        getAttrs: (dom) => {
          if (!(dom instanceof HTMLElement)) return false;
          return {
            hash: dom.dataset.hash ?? '',
            name: dom.dataset.name ?? '',
            mime: dom.dataset.mime ?? '',
            display: ['media', 'attachment'].includes(dom.dataset.display ?? '')
              ? dom.dataset.display
              : null,
            width: parseWidth(dom.dataset.width),
            alignment: parseAlignment(dom.dataset.align),
          };
        },
      },
    ],
    toDOM: (node) => {
      const attrs = getNodeAttrs(node);
      return [
        'div',
        {
          'data-type': ATTACHMENT_NODE_ID,
          'data-hash': attrs.hash,
          'data-name': attrs.name,
          'data-mime': attrs.mime,
          ...(attrs.display && { 'data-display': attrs.display }),
          ...(attrs.width && { 'data-width': attrs.width }),
          ...(attrs.alignment && { 'data-align': attrs.alignment }),
        },
        attrs.name,
      ];
    },
    parseMarkdown: {
      match: (node) => node.type === ATTACHMENT_NODE_ID,
      runner: (state, node, type) => {
        const attachment = node as AttachmentMarkdownNode;
        const hash = typeof attachment.hash === 'string' ? attachment.hash : '';
        const name = typeof attachment.name === 'string' ? attachment.name : '';
        const mime = typeof attachment.mime === 'string' ? attachment.mime : '';
        if (hash)
          state.addNode(type, {
            hash,
            name,
            mime,
            display:
              attachment.display === 'media' || attachment.display === 'attachment'
                ? attachment.display
                : null,
            width: parseWidth(attachment.width),
            alignment: parseAlignment(attachment.alignment),
          });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === ATTACHMENT_NODE_ID,
      runner: (state, node) => {
        state.addNode('html', undefined, serializeAttachment(getNodeAttrs(node)));
      },
    },
  }));

  return { remarkAttachmentPlugin, attachmentNode };
}
