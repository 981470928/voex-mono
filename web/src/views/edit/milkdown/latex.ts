import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { NodeSelection, TextSelection, Plugin } from '@milkdown/kit/prose/state';
import type { NodeView } from '@milkdown/kit/prose/view';
import { $prose, $view } from '@milkdown/kit/utils';
import { renderLatex } from './latex-renderer';

import {
  LATEX_NODE_ID,
  createLatexSchema,
  readLatexAttrs,
  type LatexAttrs,
} from '@voex/editor-schema/latex';
export {
  LATEX_NODE_ID,
  DEFAULT_LATEX,
  HEX_COLOR,
  readLatexAttrs,
  type LatexAttrs,
} from '@voex/editor-schema/latex';

interface LatexOptions {
  readonly: () => boolean;
  onEdit: (position: number) => void;
}

export function createLatexExtension(options: LatexOptions) {
  const refreshers = new Set<() => void>();
  const { remarkLatex, latexNode } = createLatexSchema();
  const latexView = $view(latexNode, () => (initialNode, view, getPos): NodeView => {
    let node = initialNode;
    let renderedCode: string | undefined;
    let version = 0;
    let destroyed = false;
    const dom = document.createElement('div');
    dom.className = 'milkdown-latex';
    dom.contentEditable = 'false';
    dom.dataset.type = LATEX_NODE_ID;
    dom.setAttribute('role', 'group');
    const viewport = document.createElement('div');
    viewport.className = 'milkdown-latex__viewport';
    const feedback = document.createElement('span');
    feedback.className = 'milkdown-latex__feedback';
    feedback.setAttribute('role', 'status');
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'milkdown-latex__edit';
    edit.textContent = '编辑公式';
    edit.onmousedown = (event) => event.preventDefault();
    edit.onclick = () => {
      const position = getPos();
      if (!options.readonly() && position !== undefined) options.onEdit(position);
    };
    dom.append(viewport, feedback, edit);

    function refresh() {
      const attrs = node.attrs as LatexAttrs;
      dom.dataset.latex = JSON.stringify(attrs);
      dom.style.height = `${attrs.height}px`;
      dom.style.fontSize = `${attrs.size}px`;
      dom.style.color = attrs.color;
      dom.setAttribute('aria-label', `LaTeX 公式：${attrs.code}`);
      edit.hidden = options.readonly();
      edit.disabled = options.readonly();
      if (renderedCode === attrs.code) return;
      renderedCode = attrs.code;
      const current = ++version;
      viewport.replaceChildren();
      feedback.hidden = false;
      feedback.textContent = '正在渲染公式…';
      void renderLatex(attrs.code)
        .then((svg) => {
          if (destroyed || current !== version) return;
          viewport.replaceChildren(svg);
          feedback.hidden = true;
        })
        .catch((cause: unknown) => {
          if (destroyed || current !== version) return;
          feedback.textContent = cause instanceof Error ? cause.message : '公式渲染失败';
          renderedCode = undefined;
        });
    }
    refreshers.add(refresh);
    refresh();
    return {
      dom,
      update(nextNode) {
        if (nextNode.type !== node.type) return false;
        node = nextNode;
        refresh();
        return true;
      },
      stopEvent: (event) => event.target instanceof Element && !!event.target.closest('button'),
      ignoreMutation: () => true,
      destroy() {
        destroyed = true;
        version++;
        refreshers.delete(refresh);
        edit.onclick = null;
        edit.onmousedown = null;
      },
    };
  });
  const latexEditing = $prose(
    () =>
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            const selection = view.state.selection;
            if (
              event.key !== 'Enter' ||
              event.isComposing ||
              options.readonly() ||
              !(selection instanceof NodeSelection) ||
              selection.node.type.name !== LATEX_NODE_ID
            )
              return false;
            options.onEdit(selection.from);
            return true;
          },
        },
      })
  );
  return {
    plugins: [...remarkLatex, latexNode, latexView, latexEditing],
    readonlyChanged: () => refreshers.forEach((refresh) => refresh()),
    selected(ctx: Ctx): LatexAttrs | null {
      const selection = ctx.get(editorViewCtx).state.selection;
      return selection instanceof NodeSelection && selection.node.type.name === LATEX_NODE_ID
        ? readLatexAttrs(selection.node.attrs)
        : null;
    },
    select(ctx: Ctx, position: number) {
      const view = ctx.get(editorViewCtx);
      if (view.state.doc.nodeAt(position)?.type.name !== LATEX_NODE_ID) return;
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)));
    },
    insert(ctx: Ctx, attrs: LatexAttrs, editing: boolean) {
      if (options.readonly() || !readLatexAttrs(attrs))
        throw new Error('当前文档不可编辑或公式参数无效');
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const selected = state.selection;
      if (editing) {
        if (!(selected instanceof NodeSelection) || selected.node.type.name !== LATEX_NODE_ID)
          throw new Error('原公式已被移除，请关闭弹窗后重试');
        view.dispatch(state.tr.setNodeMarkup(selected.from, undefined, attrs).scrollIntoView());
        return;
      }
      if (selected.$from.parent.type.spec.code) throw new Error('请将光标移到正文后插入公式');
      const transaction = state.tr.replaceSelectionWith(latexNode.type(ctx).create(attrs), false);
      const after = transaction.selection.to;
      if (after === transaction.doc.content.size) {
        const paragraph = state.schema.nodes.paragraph;
        if (paragraph) transaction.insert(after, paragraph.create());
        transaction.setSelection(TextSelection.near(transaction.doc.resolve(after), 1));
      }
      view.dispatch(transaction.scrollIntoView());
    },
  };
}
