import { parserCtx } from '@milkdown/kit/core';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, type SelectionBookmark } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export const FILE_UPLOAD_MESSAGE = '请通过添加附件上传文件';

export function hasOtherFiles(files: FileList | undefined): boolean {
  return !!files && Array.from(files).some((file) => !file.type.startsWith('image/'));
}

export interface PasteContext {
  view: EditorView;
  event: ClipboardEvent;
  slice: Slice;
}

// 返回 null 表示交给下一个转换器；未来特殊格式可在这里复用同一插入生命周期。
export type PasteTransformer = (context: PasteContext) => Promise<Slice> | null;

export function createEditorPaste(options: {
  readonly: () => boolean;
  onError: (message: string) => void;
  importImages: (view: EditorView, files: File[]) => Promise<ProseMirrorNode[]>;
  importSource: (view: EditorView, node: ProseMirrorNode) => Promise<ProseMirrorNode>;
  transformers?: PasteTransformer[];
}) {
  const key = new PluginKey('voex-editor-paste');
  const pending = new Map<number, SelectionBookmark>();
  let nextId = 0;
  let epoch = 0;
  let disposed = false;
  let currentView: EditorView | null = null;
  const readonly = () => disposed || options.readonly();

  function imageTransformer({ view, event, slice }: PasteContext): Promise<Slice> | null {
    const files = Array.from(event.clipboardData?.files ?? []);
    let imageCount = 0;
    slice.content.descendants((node) => {
      if (node.type.name === 'image') imageCount++;
    });
    // HTML/Markdown 图片优先，避免同一剪贴板的 files 和 img 重复插入。
    if (imageCount) {
      const uploaded = files.length === imageCount ? options.importImages(view, files) : null;
      let imageIndex = 0;
      const transform = async (fragment: Fragment): Promise<Fragment> => {
        const nodes: ProseMirrorNode[] = [];
        fragment.forEach((node) => nodes.push(node));
        return Fragment.fromArray(
          await Promise.all(
            nodes.map(async (node) => {
              if (node.type.name === 'image') {
                // 浏览器复制单图时优先采用剪贴板文件，避免外链的 CORS 限制。
                if (uploaded) {
                  const index = imageIndex++;
                  const image = (await uploaded)[index];
                  if (!image) throw new Error('图片导入失败，请重试');
                  return image.type.create(
                    {
                      ...image.attrs,
                      alt: node.attrs.alt || image.attrs.alt,
                      title: node.attrs.title,
                    },
                    null,
                    node.marks
                  );
                }
                return options.importSource(view, node);
              }
              return node.content.size ? node.copy(await transform(node.content)) : node;
            })
          )
        );
      };
      return transform(slice.content).then(
        (content) => new Slice(content, slice.openStart, slice.openEnd)
      );
    }
    if (!files.length) return null;
    return options
      .importImages(view, files)
      .then((nodes) => new Slice(Fragment.fromArray(nodes), 0, 0));
  }

  const plugin = $prose(
    (ctx) =>
      new Plugin({
        key,
        state: {
          init: () => null,
          apply(transaction) {
            pending.forEach((bookmark, id) => pending.set(id, bookmark.map(transaction.mapping)));
            return null;
          },
        },
        props: {
          handleDOMEvents: {
            paste: (_view, event) => {
              if (!readonly()) return false;
              event.preventDefault();
              return true;
            },
          },
          handlePaste(view, event, originalSlice) {
            if (readonly()) return true;
            if (hasOtherFiles(event.clipboardData?.files)) {
              options.onError(FILE_UPLOAD_MESSAGE);
              // 含其他文件时拒绝整批文件，但正文依然正常粘贴。
              if (
                event.clipboardData?.getData('text/plain') ||
                event.clipboardData?.getData('text/html')
              ) {
                const withoutImages = (fragment: Fragment): Fragment => {
                  const nodes: ProseMirrorNode[] = [];
                  fragment.forEach((node) => {
                    if (node.type.name !== 'image')
                      nodes.push(node.content.size ? node.copy(withoutImages(node.content)) : node);
                  });
                  return Fragment.fromArray(nodes);
                };
                const slice = new Slice(
                  withoutImages(originalSlice.content),
                  originalSlice.openStart,
                  originalSlice.openEnd
                );
                view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
              }
              return true;
            }
            if (view.state.selection.$from.parent.type.spec.code) return false;
            let slice = originalSlice;
            const data = event.clipboardData;
            const text = data?.getData('text/plain') ?? '';
            if (!data?.getData('text/html') && /!\[|<img\b/i.test(text)) {
              try {
                const parsed = ctx.get(parserCtx)(text);
                slice = new Slice(parsed.content, 0, 0);
              } catch {
                // 非法 Markdown 保留给原有纯文本粘贴流程。
              }
            }
            const id = ++nextId;
            const current = epoch;
            pending.set(id, view.state.selection.getBookmark());
            let result: Promise<Slice> | null = null;
            try {
              for (const transform of [...(options.transformers ?? []), imageTransformer]) {
                result = transform({ view, event, slice });
                if (result) break;
              }
            } catch (cause) {
              pending.delete(id);
              options.onError(cause instanceof Error ? cause.message : '粘贴失败，请重试');
              return true;
            }
            if (!result) {
              pending.delete(id);
              return false;
            }
            view.dispatch(view.state.tr.setMeta(key, true));
            void result
              .then((content) => {
                const bookmark = pending.get(id);
                if (readonly() || view.isDestroyed || current !== epoch || !bookmark) return;
                const selection = bookmark.resolve(view.state.doc);
                view.dispatch(
                  view.state.tr.setSelection(selection).replaceSelection(content).scrollIntoView()
                );
              })
              .catch((cause: unknown) => {
                if (!readonly() && current === epoch)
                  options.onError(cause instanceof Error ? cause.message : '图片导入失败，请重试');
              })
              .finally(() => {
                pending.delete(id);
                if (!disposed && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true));
              });
            return true;
          },
          decorations(state) {
            return DecorationSet.create(
              state.doc,
              Array.from(pending, ([id, bookmark]) => {
                const dom = document.createElement('span');
                dom.className = 'milkdown-editor__upload';
                dom.contentEditable = 'false';
                dom.setAttribute('role', 'status');
                dom.textContent = '正在导入图片…';
                return Decoration.widget(bookmark.resolve(state.doc).from, dom, {
                  key: String(id),
                });
              })
            );
          },
        },
        view(view) {
          currentView = view;
          return {
            destroy: () => {
              // Reconfiguring ProseMirror plugins recreates views, not this extension.
              if (currentView === view) currentView = null;
              epoch++;
              pending.clear();
            },
          };
        },
      })
  );

  return {
    plugins: [plugin],
    readonlyChanged() {
      epoch++;
      pending.clear();
      if (currentView && !currentView.isDestroyed)
        currentView.dispatch(currentView.state.tr.setMeta(key, true));
    },
    destroy() {
      disposed = true;
      epoch++;
      pending.clear();
    },
  };
}
