import { createCardSchema } from '@voex/editor-schema/cards';
import { editorViewCtx } from '@milkdown/kit/core';
import { hrSchema } from '@milkdown/kit/preset/commonmark';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { splitBlock } from '@milkdown/kit/prose/commands';
import { closeHistory } from '@milkdown/kit/prose/history';
import { dropPoint } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Ctx } from '@milkdown/kit/ctx';
import { Fragment, Slice, type Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  NodeSelection,
  Plugin,
  TextSelection,
  type SelectionBookmark,
} from '@milkdown/kit/prose/state';
import { $inputRule, $prose, $view } from '@milkdown/kit/utils';
import type { createImageImport } from './image-import';
import { createCardListView, createCardItemView } from './card-list-view';
import {
  CARD_LIST,
  CARD_ITEM,
  CARD_TEXT,
  safeCardImage,
  cardImageSize,
  cardAncestor,
  emptyCard,
  inCardText,
  validCardList,
  type CardLayout,
} from './card-list-model';

export interface CardListOptions {
  readonly: () => boolean;
  imageImport: ReturnType<typeof createImageImport>;
  onError: (message: string) => void;
}
export interface CardViewContext extends CardListOptions {
  refreshers: Set<() => void>;
  selectionRefreshers: Set<() => void>;
  epoch: () => number;
  sources: Map<symbol, { bookmark: SelectionBookmark; node: ProseNode }>;
  startImageDrag: (view: EditorView, event: DragEvent, pos: number, owner: HTMLElement) => void;
  cancelImageDrag: (owner?: HTMLElement) => void;
  dropImage: (view: EditorView, event: DragEvent, targetCard?: number) => boolean;
}

export function createCardListExtension(options: CardListOptions) {
  let epoch = 0;
  const refreshers = new Set<() => void>();
  const selectionRefreshers = new Set<() => void>();
  const sources: CardViewContext['sources'] = new Map();
  const imageDragType = 'application/x-voex-card-image';
  let imageDrag: {
    view: EditorView;
    owner: HTMLElement;
    pos: number;
    src: string;
    alt: string;
    slice: Slice;
  } | null = null;

  function cancelImageDrag(owner?: HTMLElement) {
    if (!imageDrag || (owner && imageDrag.owner !== owner)) return;
    if (imageDrag.view.dragging?.slice === imageDrag.slice) imageDrag.view.dragging = null;
    imageDrag = null;
  }

  function startImageDrag(view: EditorView, event: DragEvent, pos: number, owner: HTMLElement) {
    cancelImageDrag();
    const source = view.state.doc.nodeAt(pos);
    const src = safeCardImage(source?.attrs.src);
    if (options.readonly() || !event.dataTransfer || source?.type.name !== CARD_ITEM || !src) {
      event.preventDefault();
      return;
    }
    const parent = cardAncestor(view.state.doc.resolve(pos));
    const image = view.state.schema.nodes.image!.create({
      src,
      alt: source.attrs.alt,
      width: cardImageSize(parent?.node.attrs.imageSize),
    });
    const { dom, text, slice } = view.serializeForClipboard(new Slice(Fragment.from(image), 0, 0));
    event.dataTransfer.clearData();
    event.dataTransfer.setData('text/html', dom.innerHTML);
    event.dataTransfer.setData('text/plain', text);
    event.dataTransfer.setData(imageDragType, '1');
    event.dataTransfer.effectAllowed = 'copyMove';
    // 源图片是卡片属性，不可让 ProseMirror 默认移动逻辑删除当前文字选区。
    view.dragging = { slice, move: false };
    imageDrag = { view, owner, pos, src, alt: source.attrs.alt, slice };
  }

  function dropImage(view: EditorView, event: DragEvent, targetCard?: number): boolean {
    if (!imageDrag && !event.dataTransfer?.types.includes(imageDragType)) return false;
    const drag = imageDrag;
    cancelImageDrag();
    if (!drag || drag.view !== view || view.isDestroyed || options.readonly()) return true;
    const source = view.state.doc.nodeAt(drag.pos);
    if (
      source?.type.name !== CARD_ITEM ||
      source.attrs.src !== drag.src ||
      source.attrs.alt !== drag.alt
    )
      return true;
    const copy = /Mac|iP/.test(view.dom.ownerDocument.defaultView!.navigator.platform)
      ? event.altKey
      : event.ctrlKey;
    const tr = closeHistory(view.state.tr);
    if (targetCard !== undefined) {
      if (targetCard === drag.pos) return true;
      const target = tr.doc.nodeAt(targetCard);
      if (target?.type.name !== CARD_ITEM) return true;
      if (target.attrs.src) {
        options.onError('请先移除图片，再拖入新图片');
        return true;
      }
      tr.setNodeMarkup(targetCard, undefined, { ...target.attrs, src: drag.src, alt: drag.alt });
    } else {
      const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!position) return true;
      const resolved = view.state.doc.resolve(position.pos);
      if (cardAncestor(resolved) || resolved.parent.type.spec.code) {
        options.onError('请将图片拖到正文或卡片的空图片位');
        return true;
      }
      const insertPos = dropPoint(view.state.doc, position.pos, drag.slice);
      if (insertPos === null) return true;
      const image = drag.slice.content.firstChild!;
      tr.replaceRangeWith(insertPos, insertPos, image);
      let imagePos = -1;
      tr.doc.descendants((node, pos) => {
        if (node === image) imagePos = pos;
      });
      // 落点不能容纳图片时，不清空源卡片。
      if (imagePos < 0) return true;
      // 协同撤销会移除新图片，保留文字光标，避免 Yjs 恢复已删除的节点选区。
      tr.setSelection(TextSelection.near(tr.doc.resolve(imagePos + image.nodeSize)));
    }
    if (!copy) {
      const sourcePos = tr.mapping.map(drag.pos);
      tr.setNodeMarkup(sourcePos, undefined, { ...source.attrs, src: '', alt: '' });
    }
    view.dispatch(tr.setMeta('uiEvent', 'drop').scrollIntoView());
    view.dispatch(closeHistory(view.state.tr));
    view.focus();
    return true;
  }

  const context: CardViewContext = {
    ...options,
    refreshers,
    selectionRefreshers,
    sources,
    startImageDrag,
    cancelImageDrag,
    dropImage,
    epoch: () => epoch,
  };
  const { remarkCards, cardText, cardItem, cardList } = createCardSchema();

  function textSlice(slice: Slice, view: Parameters<typeof createCardListView>[1]): Slice {
    const paragraphs: ProseNode[] = [];
    let inline: ProseNode[] = [];
    const flush = () => {
      paragraphs.push(view.state.schema.nodes[CARD_TEXT]!.create(null, inline));
      inline = [];
    };
    const visit = (node: ProseNode) => {
      if (node.isText) {
        const type = view.state.schema.nodes[CARD_TEXT]!;
        inline.push(node.mark(node.marks.filter((mark) => type.allowsMarkType(mark.type))));
      } else if (node.type.name === 'voex_emoji' && node.attrs.char) {
        inline.push(view.state.schema.text(String(node.attrs.char)));
      } else if (node.type.name === 'hardbreak') flush();
      else if (!node.isLeaf) {
        node.forEach(visit);
        if (node.isTextblock) flush();
      }
    };
    slice.content.forEach(visit);
    if (inline.length || !paragraphs.length) flush();
    return new Slice(Fragment.fromArray(paragraphs), 1, 1);
  }

  const safeHr = $inputRule(
    (ctx) =>
      new InputRule(/^(?:---|___\s|\*\*\*\s)$/, (state, match, start, end) => {
        if (inCardText(state.selection)) return null;
        return match[0] ? state.tr.replaceWith(start - 1, end, hrSchema.type(ctx).create()) : null;
      })
  );

  const guard = $prose(
    () =>
      new Plugin({
        state: {
          init: () => null,
          apply: (tr) => {
            if (imageDrag) {
              const mapped = tr.mapping.mapResult(imageDrag.pos);
              const source = tr.doc.nodeAt(mapped.pos);
              if (
                mapped.deleted ||
                source?.type.name !== CARD_ITEM ||
                source.attrs.src !== imageDrag.src ||
                source.attrs.alt !== imageDrag.alt
              )
                cancelImageDrag();
              else imageDrag.pos = mapped.pos;
            }
            sources.forEach((source, key) =>
              sources.set(key, { ...source, bookmark: source.bookmark.map(tr.mapping) })
            );
            return null;
          },
        },
        view() {
          return { update: () => selectionRefreshers.forEach((refresh) => refresh()) };
        },
        filterTransaction: (tr) => {
          if (!tr.docChanged) return true;
          let valid = true;
          tr.doc.descendants((node) => {
            if (node.type.name === CARD_LIST) {
              valid &&= validCardList(node);
              return false;
            }
          });
          return valid;
        },
        props: {
          handlePaste(view, event, slice) {
            if (!inCardText(view.state.selection)) return false;
            if (options.readonly()) return true;
            if (event.clipboardData?.files.length && !event.clipboardData.getData('text/plain')) {
              options.onError('文字区域只支持文字，请将图片添加到卡片的图片区域');
              return true;
            }
            const text = textSlice(slice, view);
            if (!text.content.textBetween(0, text.content.size) && slice.content.size) {
              options.onError('文字区域只支持文字，请使用卡片的图片区域添加图片');
              return true;
            }
            view.dispatch(view.state.tr.replaceSelection(text).scrollIntoView());
            return true;
          },
          handleDrop(view, event, slice, moved) {
            if (dropImage(view, event)) return true;
            const target = event.target instanceof Element ? event.target : null;
            const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (
              !target?.closest('.milkdown-card__body') &&
              !(position && cardAncestor(view.state.doc.resolve(position.pos)))
            )
              return false;
            if (options.readonly()) return true;
            // 图片区域由 NodeView 处理；正文拒绝整个拖放，防止拟合到组件外部。
            let textOnly = !event.dataTransfer?.files.length;
            slice.content.descendants((node) => {
              if (node.isLeaf && !node.isText) textOnly = false;
            });
            if (!textOnly || !position) {
              options.onError('文字区域只支持文字，请将图片拖到卡片的图片区域');
              return true;
            }
            const text = textSlice(slice, view);
            if (!text.content.textBetween(0, text.content.size)) return true;
            const { selection } = view.state;
            if (moved && position.pos >= selection.from && position.pos <= selection.to)
              return true;
            const tr = view.state.tr;
            if (moved) tr.deleteSelection();
            const targetPos = tr.mapping.map(position.pos);
            tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos)));
            view.dispatch(tr.replaceSelection(text).scrollIntoView());
            return true;
          },
          handleKeyDown(view, event) {
            if (options.readonly() || event.isComposing || view.composing) return false;
            const ancestor = cardAncestor(view.state.selection.$from);
            if (!ancestor) return false;
            if (event.key === 'Enter' && event.shiftKey)
              return splitBlock(view.state, view.dispatch);
            if (event.key === 'Escape') {
              view.dispatch(
                view.state.tr.setSelection(NodeSelection.create(view.state.doc, ancestor.pos))
              );
              view.focus();
              return true;
            }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              const after = ancestor.pos + ancestor.node.nodeSize;
              const tr = view.state.tr;
              if (!tr.doc.nodeAt(after)?.isTextblock)
                tr.insert(after, view.state.schema.nodes.paragraph!.create());
              view.dispatch(
                tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1)).scrollIntoView()
              );
              view.focus();
              return true;
            }
            return false;
          },
        },
      })
  );
  return {
    guardPlugins: [guard],
    plugins: [
      ...remarkCards,
      cardText,
      cardItem,
      cardList,
      safeHr,
      $view(
        cardList,
        () => (node, view, getPos) => createCardListView(node, view, getPos, context)
      ),
      $view(
        cardItem,
        () => (node, view, getPos) => createCardItemView(node, view, getPos, context)
      ),
    ],
    readonlyChanged() {
      epoch++;
      cancelImageDrag();
      sources.clear();
      refreshers.forEach((refresh) => refresh());
    },
    insert(ctx: Ctx, layout: CardLayout) {
      const view = ctx.get(editorViewCtx);
      if (options.readonly() || view.isDestroyed || inCardText(view.state.selection)) return;
      if (view.state.selection.$from.parent.type.spec.code) return;
      const node = cardList
        .type(ctx)
        .create({ layout }, [emptyCard(view.state.schema), emptyCard(view.state.schema)]);
      const tr = view.state.tr.replaceSelectionWith(node, false);
      let position = -1;
      tr.doc.descendants((current, pos) => {
        if (current === node) position = pos;
      });
      if (position >= 0) tr.setSelection(NodeSelection.create(tr.doc, position));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    },
  };
}
