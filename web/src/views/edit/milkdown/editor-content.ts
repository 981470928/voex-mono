import { editorViewCtx, editorViewOptionsCtx } from '@milkdown/kit/core';
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import { uploadConfig } from '@milkdown/kit/plugin/upload';
import { headingIdGenerator, listItemSchema } from '@milkdown/kit/preset/commonmark';
import { ySyncPluginKey } from 'y-prosemirror';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeViewConstructor,
} from '@milkdown/kit/prose/view';
import { $prose, $view } from '@milkdown/kit/utils';
import { createResizableImages } from './image-resize';
import { FILE_UPLOAD_MESSAGE, hasOtherFiles } from './editor-paste';
import type { createImageImport } from './image-import';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';

interface EditorContentOptions {
  readonly: () => boolean;
  collaborative?: () => boolean;
  onError: (message: string) => void;
  imageImport: ReturnType<typeof createImageImport>;
  onAttachment: (view: EditorView, pos: number, node: ProseMirrorNode) => void;
}

export interface EditorContent {
  plugins: MilkdownPlugin[];
  configure: (ctx: Ctx) => void;
  readonlyChanged: () => void;
  replaceSavedDocument: (ctx: Ctx, document: ProseMirrorNode) => void;
  destroy: () => void;
}

export function createEditorContent(options: EditorContentOptions): EditorContent {
  const guardKey = new PluginKey('voex-editor-content');
  const taskRefreshers = new Set<() => void>();
  let currentView: EditorView | null = null;
  let disposed = false;
  let readonlyEpoch = 0;
  let replacingSavedDocument = false;
  const images = createResizableImages(options);

  const isReadonly = () => disposed || options.readonly();

  const createListItemView: NodeViewConstructor = (initialNode, view, getPos) => {
    let node = initialNode;
    const isTask = typeof node.attrs.checked === 'boolean';
    const dom = document.createElement('li');
    const contentDOM = isTask ? document.createElement('div') : dom;
    const checkbox = isTask ? document.createElement('input') : null;

    const refresh = () => {
      dom.dataset.label = String(node.attrs.label);
      dom.dataset.listType = String(node.attrs.listType);
      dom.dataset.spread = String(node.attrs.spread);
      if (!checkbox) return;

      dom.dataset.itemType = 'task';
      dom.dataset.checked = String(node.attrs.checked);
      checkbox.checked = node.attrs.checked === true;
      checkbox.disabled = isReadonly();
      checkbox.setAttribute('aria-label', checkbox.checked ? '标记为未完成' : '标记为完成');
    };

    if (checkbox) {
      checkbox.type = 'checkbox';
      checkbox.className = 'milkdown-editor__task-checkbox';
      checkbox.contentEditable = 'false';
      contentDOM.className = 'milkdown-editor__list-content';
      checkbox.onmousedown = (event) => event.preventDefault();
      checkbox.onchange = () => {
        const pos = getPos();
        if (isReadonly() || view.isDestroyed || pos === undefined) {
          refresh();
          return;
        }

        view.dispatch(
          view.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            checked: checkbox.checked,
          })
        );
        view.focus();
      };
      dom.append(checkbox, contentDOM);
      taskRefreshers.add(refresh);
    }
    refresh();

    return {
      dom,
      contentDOM,
      update(nextNode) {
        if (nextNode.type !== node.type || (typeof nextNode.attrs.checked === 'boolean') !== isTask)
          return false;

        node = nextNode;
        refresh();
        return true;
      },
      stopEvent: (event) => event.target === checkbox,
      ignoreMutation: (mutation) =>
        mutation.type !== 'selection' &&
        (mutation.target === checkbox ||
          (mutation.type === 'attributes' && mutation.target === dom)),
      destroy() {
        taskRefreshers.delete(refresh);
        if (checkbox) {
          checkbox.onmousedown = null;
          checkbox.onchange = null;
        }
      },
    };
  };

  // Keep derived heading anchors out of document transactions. A nested
  // addToHistory:false transaction can make Yjs skip the user's heading edit.
  const headingAnchors = $prose((ctx) => {
    let previousDocument: ProseMirrorNode | null = null;
    let decorations = DecorationSet.empty;
    return new Plugin({
      props: {
        decorations(state) {
          if (!options.collaborative?.()) return DecorationSet.empty;
          if (state.doc === previousDocument) return decorations;
          previousDocument = state.doc;
          const getId = ctx.get(headingIdGenerator.key);
          const counts = new Map<string, number>();
          const anchors: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'heading') return true;
            if (!node.textContent.trim()) return false;
            const base = getId(node);
            const count = (counts.get(base) ?? 0) + 1;
            counts.set(base, count);
            anchors.push(
              Decoration.node(pos, pos + node.nodeSize, {
                id: count === 1 ? base : `${base}-#${count}`,
              })
            );
            return false;
          });
          decorations = DecorationSet.create(state.doc, anchors);
          return decorations;
        },
      },
    });
  });

  const guard = $prose(
    () =>
      new Plugin({
        key: guardKey,
        // editable 只约束用户输入，异步操作和外部命令还需拦截 transaction。
        filterTransaction: (transaction) =>
          !isReadonly() ||
          !transaction.docChanged ||
          (!disposed &&
            (replacingSavedDocument ||
              (!!options.collaborative?.() && !!transaction.getMeta(ySyncPluginKey)))),
        props: {
          handleDOMEvents: {
            drop: (_view, event) => {
              if (!isReadonly()) return false;
              event.preventDefault();
              return true;
            },
          },
          handleDrop(view, event, _slice, moved) {
            if (isReadonly()) return true;
            if (moved || view.dragging || !hasOtherFiles(event.dataTransfer?.files)) return false;
            options.onError(FILE_UPLOAD_MESSAGE);
            return true;
          },
          decorations(state) {
            if (isReadonly() || !state.selection.empty) return DecorationSet.empty;
            const { $from } = state.selection;
            if (
              $from.depth === 0 ||
              $from.parent.type.name !== 'paragraph' ||
              $from.parent.content.size > 0
            )
              return DecorationSet.empty;

            return DecorationSet.create(state.doc, [
              Decoration.node($from.before(), $from.after(), {
                class: 'milkdown-editor__empty',
                'data-placeholder': '输入 / 插入内容',
              }),
            ]);
          },
        },
        view(view) {
          currentView = view;
          return {
            // ProseMirror recreates plugin views when collaboration is connected.
            // The component owns final disposal; reconfiguration only releases this view.
            destroy() {
              if (currentView === view) currentView = null;
            },
          };
        },
      })
  );

  function configure(ctx: Ctx) {
    images.configure(ctx);
    ctx.update(editorViewOptionsCtx, (config) => ({
      ...config,
      dispatchTransaction(this: EditorView, transaction) {
        // upload 完成后仍会 dispatch，卸载后的空 transaction 也需丢弃。
        if (disposed || this.isDestroyed) return;
        if (config.dispatchTransaction) config.dispatchTransaction.call(this, transaction);
        else this.updateState(this.state.apply(transaction));
      },
    }));
    ctx.update(uploadConfig.key, (config) => ({
      ...config,
      enableHtmlFileUploader: false,
      uploadWidgetFactory: (pos, spec) => {
        const dom = document.createElement('span');
        dom.className = 'milkdown-editor__upload';
        dom.contentEditable = 'false';
        dom.setAttribute('role', 'status');
        dom.textContent = '正在导入图片…';
        return Decoration.widget(pos, dom, spec);
      },
      uploader: async (files) => {
        if (isReadonly()) return [];
        if (hasOtherFiles(files)) {
          options.onError(FILE_UPLOAD_MESSAGE);
          return [];
        }

        const epoch = readonlyEpoch;
        try {
          if (!currentView) return [];
          const nodes = await options.imageImport.importImages(currentView, Array.from(files));
          // 权限先关闭再恢复时，旧操作也不能继续写入。
          return isReadonly() || epoch !== readonlyEpoch ? [] : nodes;
        } catch (cause) {
          if (!isReadonly() && epoch === readonlyEpoch) {
            options.onError(cause instanceof Error ? cause.message : '图片读取失败，请重试');
          }
          // upload 的成功分支负责移除占位符，失败也返回空节点。
          return [];
        }
      },
    }));
  }

  function readonlyChanged() {
    readonlyEpoch++;
    images.readonlyChanged();
    taskRefreshers.forEach((refresh) => refresh());
    if (!disposed && currentView && !currentView.isDestroyed) {
      currentView.dispatch(currentView.state.tr.setMeta(guardKey, true));
    }
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    readonlyEpoch++;
    taskRefreshers.clear();
    images.destroy();
    currentView = null;
  }

  function replaceSavedDocument(ctx: Ctx, document: ProseMirrorNode) {
    if (disposed || !currentView || currentView.isDestroyed) throw new Error('编辑器已关闭');
    const view = ctx.get(editorViewCtx);
    // Only this synchronous host save acknowledgement can cross the temporary readonly lock.
    // Asynchronous uploads, paste handlers and ordinary user transactions remain blocked.
    replacingSavedDocument = true;
    try {
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, document.content));
    } finally {
      replacingSavedDocument = false;
    }
  }

  return {
    plugins: [
      guard,
      headingAnchors,
      $view(listItemSchema.node, () => createListItemView),
      ...images.plugins,
    ],
    configure,
    readonlyChanged,
    replaceSavedDocument,
    destroy,
  };
}
