import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { NodeSelection, Plugin } from '@milkdown/kit/prose/state';
import type { EditorView, NodeView } from '@milkdown/kit/prose/view';
import { $prose, $view } from '@milkdown/kit/utils';
import { getTwemojiUrl, type Emoji } from '@/constant/emoji';

import { EMOJI_NODE_ID, getEmoji, createEmojiSchema } from '@voex/editor-schema/emoji';

function createEmojiView(initialNode: ProseMirrorNode): NodeView {
  let node = initialNode;
  const dom = document.createElement('span');
  dom.className = 'milkdown-emoji';
  dom.contentEditable = 'false';
  dom.setAttribute('role', 'img');
  const image = document.createElement('img');
  image.className = 'milkdown-emoji__image';
  image.alt = '';
  image.draggable = false;
  image.referrerPolicy = 'no-referrer';
  image.setAttribute('aria-hidden', 'true');
  const fallback = document.createElement('span');
  fallback.className = 'milkdown-emoji__fallback';
  fallback.setAttribute('aria-hidden', 'true');
  dom.append(image, fallback);
  image.onload = () => {
    image.hidden = false;
    fallback.hidden = true;
  };
  image.onerror = () => {
    image.hidden = true;
    fallback.hidden = false;
  };
  function refresh() {
    const emoji = getEmoji(node);
    dom.dataset.emoji = node.attrs.char as string;
    dom.setAttribute('aria-label', emoji?.name ?? dom.dataset.emoji);
    dom.title = emoji?.name ?? dom.dataset.emoji;
    fallback.textContent = dom.dataset.emoji;
    image.hidden = true;
    fallback.hidden = false;
    if (emoji) image.src = getTwemojiUrl(emoji);
  }
  refresh();
  return {
    dom,
    update(nextNode) {
      if (nextNode.type !== node.type) return false;
      if (nextNode.attrs.char !== node.attrs.char) {
        node = nextNode;
        refresh();
      }
      return true;
    },
    ignoreMutation: () => true,
    destroy() {
      image.onload = null;
      image.onerror = null;
    },
  };
}

export function createEmojiExtension() {
  const { remarkEmoji, emojiNode } = createEmojiSchema();
  const emojiView = $view(emojiNode, () => createEmojiView);
  // 直接删除模型节点，避免浏览器在 contenteditable 图片旁原生删除时改写相邻文本。
  function deleteEmoji(view: EditorView, backward: boolean): boolean {
    if (!view.editable || view.composing) return false;
    const { state } = view;
    const { selection } = state;
    if (selection instanceof NodeSelection && selection.node.type.name === EMOJI_NODE_ID) {
      view.dispatch(state.tr.deleteSelection().scrollIntoView());
      return true;
    }
    if (!selection.empty) return false;
    const node = backward ? selection.$from.nodeBefore : selection.$from.nodeAfter;
    if (node?.type.name !== EMOJI_NODE_ID) return false;
    const from = backward ? selection.from - node.nodeSize : selection.from;
    view.dispatch(state.tr.delete(from, from + node.nodeSize).scrollIntoView());
    return true;
  }
  const emojiEditing = $prose(
    () =>
      new Plugin({
        appendTransaction(transactions, _previousState, state) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const replacements: { pos: number; node: ProseMirrorNode }[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name === EMOJI_NODE_ID && node.marks.some((mark) => mark.type.spec.code))
              replacements.push({ pos, node });
          });
          if (!replacements.length) return null;
          const transaction = state.tr;
          // Milkdown 的 inlineCode serializer 只接受文本，先还原字符以免格式切换丢失 emoji。
          for (const { pos, node } of replacements.reverse())
            transaction.replaceWith(
              pos,
              pos + node.nodeSize,
              state.schema.text(node.attrs.char as string, node.marks)
            );
          return transaction;
        },
        props: {
          handleKeyDown(view, event) {
            if (
              event.isComposing ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            )
              return false;
            if (event.key === 'Backspace') return deleteEmoji(view, true);
            if (event.key === 'Delete') return deleteEmoji(view, false);
            return false;
          },
          handleDOMEvents: {
            beforeinput(view, event) {
              if (event.isComposing) return false;
              const backward = event.inputType === 'deleteContentBackward';
              if (!backward && event.inputType !== 'deleteContentForward') return false;
              if (!deleteEmoji(view, backward)) return false;
              event.preventDefault();
              return true;
            },
          },
        },
      })
  );
  return {
    plugins: [...remarkEmoji, emojiNode, emojiView, emojiEditing],
    insert(ctx: Ctx, emoji: Emoji) {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const marks = state.storedMarks ?? state.selection.$from.marks();
      // 代码区域保持纯文本，与 Markdown code 的解析和复制行为一致。
      if (
        state.selection.$from.parent.type.spec.code ||
        marks.some((mark) => mark.type.spec.code)
      ) {
        view.dispatch(state.tr.insertText(emoji.char).scrollIntoView());
        return;
      }
      view.dispatch(
        state.tr
          .replaceSelectionWith(emojiNode.type(ctx).create({ char: emoji.char }))
          .scrollIntoView()
      );
    },
  };
}
