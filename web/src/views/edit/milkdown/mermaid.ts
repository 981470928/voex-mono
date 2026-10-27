import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { NodeSelection, Plugin, TextSelection } from '@milkdown/kit/prose/state';
import type { NodeView } from '@milkdown/kit/prose/view';
import { $prose, $view } from '@milkdown/kit/utils';
import { renderMermaid } from './mermaid-renderer';

import { MERMAID_NODE_ID, createMermaidSchema } from '@voex/editor-schema/mermaid';
export { MERMAID_NODE_ID, DEFAULT_MERMAID_CODE } from '@voex/editor-schema/mermaid';

interface MermaidOptions {
  readonly: () => boolean;
  onEdit: (position: number) => void;
}

export function createMermaidExtension(options: MermaidOptions) {
  const refreshers = new Set<() => void>();
  let editingTarget: ProseNode | null = null;
  const { remarkMermaid, mermaidNode } = createMermaidSchema();
  const mermaidView = $view(mermaidNode, () => (initialNode, view, getPos): NodeView => {
    let node = initialNode;
    let renderedKey: string | undefined;
    let version = 0;
    let destroyed = false;
    const dom = document.createElement('div');
    dom.className = 'milkdown-mermaid';
    dom.contentEditable = 'false';
    dom.dataset.type = MERMAID_NODE_ID;
    dom.setAttribute('role', 'group');
    dom.setAttribute('aria-label', '流程图');
    const viewport = document.createElement('div');
    viewport.className = 'milkdown-mermaid__viewport';
    const feedback = document.createElement('span');
    feedback.className = 'milkdown-mermaid__feedback';
    feedback.setAttribute('role', 'status');
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'milkdown-mermaid__edit';
    edit.textContent = '编辑流程图';
    edit.onmousedown = (event) => event.preventDefault();
    edit.onclick = () => {
      const position = getPos();
      if (
        !options.readonly() &&
        !view.isDestroyed &&
        position !== undefined &&
        view.state.doc.nodeAt(position) === node
      )
        options.onEdit(position);
    };
    dom.append(viewport, feedback, edit);

    function refresh() {
      const code = node.attrs.code as string;
      dom.dataset.mermaid = code;
      edit.hidden = options.readonly();
      edit.disabled = options.readonly();
      const key = JSON.stringify([code, document.documentElement.dataset.theme]);
      if (renderedKey === key) return;
      renderedKey = key;
      const current = ++version;
      dom.dataset.state = 'loading';
      viewport.setAttribute('aria-busy', 'true');
      viewport.replaceChildren();
      feedback.hidden = false;
      feedback.textContent = '正在渲染流程图…';
      void renderMermaid(code)
        .then((svg) => {
          if (destroyed || current !== version) return;
          viewport.replaceChildren(svg);
          viewport.removeAttribute('aria-busy');
          feedback.hidden = true;
          dom.dataset.state = 'ready';
        })
        .catch((cause: unknown) => {
          if (destroyed || current !== version) return;
          viewport.removeAttribute('aria-busy');
          feedback.textContent = cause instanceof Error ? cause.message : '流程图渲染失败';
          dom.dataset.state = 'error';
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
      stopEvent: (event) => event.target instanceof Node && edit.contains(event.target),
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
  const mermaidEditing = $prose(
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
              selection.node.type.name !== MERMAID_NODE_ID
            )
              return false;
            options.onEdit(selection.from);
            return true;
          },
        },
        view() {
          const observer = new MutationObserver(() => refreshers.forEach((refresh) => refresh()));
          observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
          });
          return { destroy: () => observer.disconnect() };
        },
      })
  );
  return {
    plugins: [...remarkMermaid, mermaidNode, mermaidView, mermaidEditing],
    readonlyChanged: () => refreshers.forEach((refresh) => refresh()),
    selected(ctx: Ctx): string | null {
      const selection = ctx.get(editorViewCtx).state.selection;
      editingTarget =
        selection instanceof NodeSelection && selection.node.type.name === MERMAID_NODE_ID
          ? selection.node
          : null;
      return editingTarget ? (editingTarget.attrs.code as string) : null;
    },
    select(ctx: Ctx, position: number) {
      const view = ctx.get(editorViewCtx);
      if (view.state.doc.nodeAt(position)?.type.name !== MERMAID_NODE_ID) return;
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)));
    },
    insert(ctx: Ctx, code: string, editing: boolean) {
      if (options.readonly()) throw new Error('当前文档不可编辑');
      const view = ctx.get(editorViewCtx);
      if (view.isDestroyed) throw new Error('文档已关闭，请关闭弹窗后重试');
      const { state } = view;
      const selected = state.selection;
      if (editing) {
        if (
          !(selected instanceof NodeSelection) ||
          selected.node.type.name !== MERMAID_NODE_ID ||
          selected.node !== editingTarget
        )
          throw new Error('原流程图已被移除或修改，请关闭弹窗后重试');
        view.dispatch(state.tr.setNodeMarkup(selected.from, undefined, { code }).scrollIntoView());
        return;
      }
      if (selected.$from.parent.type.spec.code) throw new Error('请将光标移到正文后插入流程图');
      const transaction = state.tr.replaceSelectionWith(
        mermaidNode.type(ctx).create({ code }),
        false
      );
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
