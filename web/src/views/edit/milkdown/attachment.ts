import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import { Fragment, type Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { TextSelection, NodeSelection } from '@milkdown/kit/prose/state';
import { closeHistory } from '@milkdown/kit/prose/history';
import type { EditorView, NodeView } from '@milkdown/kit/prose/view';
import { $node, $view } from '@milkdown/kit/utils';
import type { FileInfo } from '@/service/api/document-api';
import { attachmentMediaKind, type AttachmentMediaOptions } from './attachment-media';
import { createResizableMediaView } from './media-resize';
import { parseWidth } from '@voex/editor-schema/images';

import {
  ATTACHMENT_NODE_ID,
  getNodeAttrs,
  createAttachmentSchema,
  isExpandedMedia,
} from '@voex/editor-schema/attachment';
export { ATTACHMENT_NODE_ID } from '@voex/editor-schema/attachment';

function createAttachmentIcon(): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  const path = document.createElementNS(namespace, 'path');
  svg.setAttribute('class', 'milkdown-attachment__icon-svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute(
    'd',
    'M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'
  );
  svg.append(path);
  return svg;
}

function createAttachmentNodeView(
  initialNode: ProseMirrorNode,
  isAvailable: (hash: string) => boolean,
  onPreview: (file: Pick<FileInfo, 'hash' | 'name' | 'mime'>) => void,
  refreshers: Set<() => void>,
  mediaOptions: AttachmentMediaOptions & { onExpand?: () => void },
  imageOptions?: {
    readonly: () => boolean;
    onImage: () => void;
  }
): NodeView {
  let node = initialNode;

  const dom = document.createElement('div');
  dom.className = 'milkdown-attachment';
  dom.dataset.type = ATTACHMENT_NODE_ID;
  dom.setAttribute('role', 'group');

  const icon = document.createElement('span');
  icon.className = 'milkdown-attachment__icon';
  icon.append(createAttachmentIcon());

  const info = document.createElement('span');
  info.className = 'milkdown-attachment__info';

  const name = document.createElement('span');
  name.className = 'milkdown-attachment__name';

  const meta = document.createElement('span');
  meta.className = 'milkdown-attachment__meta';

  const unavailable = document.createElement('span');
  unavailable.className = 'milkdown-attachment__unavailable';
  unavailable.textContent = '附件不可用';

  const preview = document.createElement('button');
  preview.className = 'milkdown-attachment__preview';
  preview.type = 'button';
  preview.textContent = '预览';
  preview.contentEditable = 'false';
  preview.setAttribute('contenteditable', 'false');

  // 使用 onclick 属性，绕过 ProseMirror 的事件处理
  preview.onclick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const attrs = getNodeAttrs(node);
    if (attrs.hash) onPreview({ hash: attrs.hash, name: attrs.name, mime: attrs.mime });
  };

  // 阻止 pointerdown 事件传播到 ProseMirror
  preview.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });

  const image = document.createElement('button');
  image.className = 'milkdown-attachment__preview';
  image.type = 'button';
  image.textContent = '显示为图片';
  image.contentEditable = 'false';
  image.onmousedown = (event) => event.preventDefault();
  image.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (mediaOptions.readonly()) return;
    if (attachmentMediaKind(String(node.attrs.mime))) mediaOptions.onExpand?.();
    else if (imageOptions && !imageOptions.readonly()) imageOptions.onImage();
  };
  info.append(name, meta, unavailable);
  dom.append(icon, info, image, preview);

  const refresh = () => {
    const attrs = getNodeAttrs(node);
    const available = isAvailable(attrs.hash);
    const kind = attachmentMediaKind(attrs.mime);
    image.textContent =
      kind === 'video' ? '显示为视频' : kind === 'audio' ? '显示为音频' : '显示为图片';
    name.textContent = attrs.name || '未命名附件';
    name.title = attrs.name || '未命名附件';
    meta.textContent = attrs.mime || '未知类型';
    preview.hidden = !available;
    image.hidden =
      !available ||
      mediaOptions.readonly() ||
      (!kind && (!attrs.mime.startsWith('image/') || !imageOptions));
    preview.title = `预览 ${attrs.name || '未命名附件'}`;
    preview.setAttribute('aria-label', `预览 ${attrs.name || '未命名附件'}`);
    unavailable.hidden = available;
    dom.classList.toggle('milkdown-attachment--unavailable', !available);
    dom.setAttribute(
      'aria-label',
      `${kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '附件'} ${attrs.name || '未命名附件'}`
    );
  };

  refreshers.add(refresh);
  refresh();

  return {
    dom,
    update(nextNode) {
      if (nextNode.type !== node.type || isExpandedMedia(nextNode)) return false;
      node = nextNode;
      refresh();
      return true;
    },
    selectNode() {
      dom.classList.add('milkdown-attachment--selected');
    },
    deselectNode() {
      dom.classList.remove('milkdown-attachment--selected');
    },
    stopEvent(event) {
      const target = event.target;
      // 如果事件目标是预览按钮或其子元素，阻止 ProseMirror 处理
      if (
        target instanceof globalThis.Node &&
        (preview.contains(target) || image.contains(target))
      ) {
        return true;
      }
      return false;
    },
    ignoreMutation() {
      return true;
    },
    destroy() {
      refreshers.delete(refresh);
      preview.onclick = null;
      image.onclick = image.onmousedown = null;
    },
  };
}

function defaultMediaWidth(view: EditorView): number {
  const style = view.dom.ownerDocument.defaultView!.getComputedStyle(view.dom);
  return (
    parseWidth(
      Math.round(
        (view.dom.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / 2
      )
    ) ?? 360
  );
}

function insertAttachmentAtSelection(
  ctx: Ctx,
  attachmentNode: ReturnType<typeof $node>,
  file: FileInfo
): boolean {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const nodeType = attachmentNode.type(ctx);
  const paragraphType = state.schema.nodes.paragraph;
  const attachment = nodeType.create({
    hash: file.hash,
    name: file.name,
    mime: file.mime,
    ...(attachmentMediaKind(file.mime) && {
      display: 'media',
      width: defaultMediaWidth(view),
      alignment: 'left',
    }),
  });
  const { $from } = state.selection;
  let transaction = state.tr;
  let selectionPosition: number;

  if ($from.depth > 0) {
    const topLevelNode = $from.node(1);
    const before = $from.before(1);
    const after = $from.after(1);
    const isEmptyParagraph = topLevelNode.type === paragraphType && topLevelNode.content.size === 0;

    if (isEmptyParagraph && paragraphType) {
      const paragraph = paragraphType.create();
      transaction = transaction.replaceWith(
        before,
        after,
        Fragment.fromArray([attachment, paragraph])
      );
      selectionPosition = before + attachment.nodeSize;
    } else {
      const nodes = [attachment];
      if (after === state.doc.content.size && paragraphType) nodes.push(paragraphType.create());
      transaction = transaction.insert(after, Fragment.fromArray(nodes));
      selectionPosition = after + attachment.nodeSize;
    }
  } else {
    const insertionPosition = state.selection.to;
    const nodes = [attachment];
    if (insertionPosition === state.doc.content.size && paragraphType) {
      nodes.push(paragraphType.create());
    }
    transaction = transaction.insert(insertionPosition, Fragment.fromArray(nodes));
    selectionPosition = insertionPosition + attachment.nodeSize;
  }

  transaction = transaction.setSelection(
    TextSelection.near(transaction.doc.resolve(selectionPosition), 1)
  );
  view.dispatch(transaction.scrollIntoView());
  view.focus();
  return true;
}

export interface AttachmentExtension {
  plugins: MilkdownPlugin[];
  insertAttachment: (ctx: Ctx, file: FileInfo) => boolean;
  refreshAvailability: () => void;
}

export function createAttachmentExtension(
  isAvailable: (hash: string) => boolean,
  onPreview: (file: Pick<FileInfo, 'hash' | 'name' | 'mime'>) => void,
  mediaOptions: AttachmentMediaOptions,
  imageOptions?: {
    readonly: () => boolean;
    onImage: (view: EditorView, pos: number, hash: string) => void;
  }
): AttachmentExtension {
  const refreshers = new Set<() => void>();
  const { remarkAttachmentPlugin, attachmentNode } = createAttachmentSchema();

  const attachmentView = $view(attachmentNode, () => (node, view, getPos) => {
    if (isExpandedMedia(node))
      return createResizableMediaView(node, view, getPos, isAvailable, mediaOptions, refreshers);
    return createAttachmentNodeView(
      node,
      isAvailable,
      onPreview,
      refreshers,
      {
        ...mediaOptions,
        onExpand: () => {
          const pos = getPos();
          if (pos === undefined || view.isDestroyed || mediaOptions.readonly()) return;
          const current = view.state.doc.nodeAt(pos);
          if (current?.type !== node.type || !attachmentMediaKind(String(current.attrs.mime)))
            return;
          const transaction = closeHistory(view.state.tr).setNodeMarkup(pos, undefined, {
            ...current.attrs,
            display: 'media',
            width: parseWidth(current.attrs.width) ?? defaultMediaWidth(view),
          });
          transaction.setSelection(NodeSelection.create(transaction.doc, pos));
          view.dispatch(transaction.scrollIntoView());
          view.dispatch(closeHistory(view.state.tr));
          view.focus();
        },
      },
      imageOptions && {
        readonly: imageOptions.readonly,
        onImage: () => {
          const pos = getPos();
          if (pos === undefined) return;
          const current = view.state.doc.nodeAt(pos);
          if (current?.type === node.type) imageOptions.onImage(view, pos, current.attrs.hash);
        },
      }
    );
  });

  return {
    plugins: [remarkAttachmentPlugin, attachmentNode, attachmentView],
    insertAttachment: (ctx, file) => insertAttachmentAtSelection(ctx, attachmentNode, file),
    refreshAvailability: () => refreshers.forEach((refresh) => refresh()),
  };
}
