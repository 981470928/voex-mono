import { createCardSchema } from '@voex/editor-schema/cards';
import { editorViewCtx } from '@milkdown/kit/core';
import { hrSchema } from '@milkdown/kit/preset/commonmark';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { splitBlock } from '@milkdown/kit/prose/commands';
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
  CARD_TEXT,
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
}

export function createCardListExtension(options: CardListOptions) {
  let epoch = 0;
  const refreshers = new Set<() => void>();
  const selectionRefreshers = new Set<() => void>();
  const sources: CardViewContext['sources'] = new Map();
  const context: CardViewContext = {
    ...options,
    refreshers,
    selectionRefreshers,
    sources,
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
