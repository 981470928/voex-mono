import {
  configureLinkTooltip,
  linkEditTooltip,
  linkPreviewTooltip,
  linkTooltipAPI,
  linkTooltipConfig,
  linkTooltipPlugin,
  linkTooltipState,
} from '@milkdown/kit/component/link-tooltip';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { linkAttr, linkSchema, sanitizeLinkHref } from '@milkdown/kit/preset/commonmark';
import type { Mark, Node as ProseNode } from '@milkdown/kit/prose/model';
import type { PluginView } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import linkIcon from '@/assets/svg/editor-link.svg?raw';
import editIcon from '@/assets/svg/write.svg?raw';
import removeIcon from '@/assets/svg/eraser.svg?raw';
import {
  createFileReferencePlugin,
  fileReferenceAt,
  isFileReference,
} from './editor-file-references';

interface LinkRange {
  mark: Mark;
  from: number;
  to: number;
}

// 7.22 的官方 preview view 由公开的 linkPreviewTooltip 配置创建；仅适配 hover 触发。
interface PreviewView extends PluginView {
  show: (mark: Mark, from: number, to: number, rect: DOMRect) => void;
  hide: () => void;
}

function linkRange(doc: ProseNode, pos: number): LinkRange | null {
  const $pos = doc.resolve(pos);
  const type = doc.type.schema.marks.link;
  if (!type) return null;
  const reference = fileReferenceAt(doc, pos);
  if (reference)
    return {
      mark: type.create({ href: reference.href }),
      from: reference.from,
      to: reference.to,
    };
  const after = $pos.parent.childAfter($pos.parentOffset);
  const before = $pos.parent.childBefore($pos.parentOffset);
  const child = after.node && type.isInSet(after.node.marks) ? after : before;
  const mark = child.node && type.isInSet(child.node.marks);
  if (!child.node || !mark) return null;
  let from = $pos.start() + child.offset;
  let to = from + child.node.nodeSize;
  for (let index = child.index - 1; index >= 0; index--) {
    const node = $pos.parent.child(index);
    if (!mark.isInSet(node.marks)) break;
    from -= node.nodeSize;
  }
  for (let index = child.index + 1; index < $pos.parent.childCount; index++) {
    const node = $pos.parent.child(index);
    if (!mark.isInSet(node.marks)) break;
    to += node.nodeSize;
  }
  return { mark, from, to };
}

function safeUrl(value: string, document: Document): string | null {
  if (isFileReference(value)) return null;
  const href = sanitizeLinkHref(value.trim());
  if (!href) return null;
  try {
    const url = new URL(href, document.baseURI);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function iconButton(label: string, icon: string) {
  return `<button type="button" aria-label="${label}" title="${label}">${icon}</button>`;
}

export function createEditorLinks(options: {
  readonly: () => boolean;
  notify: (message: string, tone: 'success' | 'error' | 'info') => void;
}) {
  let dismiss: (() => void) | undefined;
  const canEdit = (view: EditorView) => !options.readonly() && view.editable && !view.isDestroyed;

  return {
    plugins: [...linkTooltipPlugin, createFileReferencePlugin()],
    hide: () => dismiss?.(),
    edit(ctx: Ctx) {
      const view = ctx.get(editorViewCtx);
      if (!canEdit(view)) return;
      const { from, to } = view.state.selection;
      const range = linkRange(view.state.doc, from);
      const api = ctx.get(linkTooltipAPI.key);
      if (range && to <= range.to) api.editLink(range.mark, range.from, range.to);
      else api.addLink(from, to);
    },
    configure(ctx: Ctx) {
      configureLinkTooltip(ctx);
      ctx.update(linkSchema.key, (previous) => (schemaCtx) => {
        const schema = previous(schemaCtx);
        return {
          ...schema,
          parseDOM: [
            {
              tag: 'a[data-voex-file-reference]',
              getAttrs: (dom) => ({
                href: dom.getAttribute('data-voex-file-reference'),
                title: dom.getAttribute('title'),
              }),
            },
            ...(schema.parseDOM ?? []),
          ],
          toDOM: (mark) =>
            isFileReference(mark.attrs.href)
              ? [
                  'a',
                  {
                    'data-voex-file-reference': mark.attrs.href,
                    title: mark.attrs.href,
                    role: 'link',
                    'aria-disabled': 'true',
                    tabindex: '0',
                  },
                  0,
                ]
              : schema.toDOM!(mark, true),
        };
      });
      ctx.update(linkAttr.key, (previous) => (mark) => ({
        ...previous(mark),
        tabindex: '0',
        target: '_blank',
        rel: 'noopener noreferrer',
      }));
      ctx.update(linkTooltipConfig.key, (config) => ({
        ...config,
        linkIcon: iconButton('复制链接', linkIcon),
        editButton: iconButton('编辑链接', editIcon),
        removeButton: iconButton('移除链接', removeIcon),
        confirmButton: iconButton('应用链接', '应用'),
        inputPlaceholder: '输入网页、邮件、电话链接或文件路径',
      }));
      ctx.update(linkTooltipAPI.key, (api) => ({
        addLink: (from, to) => {
          if (canEdit(ctx.get(editorViewCtx))) api.addLink(from, to);
        },
        editLink: (mark, from, to) => {
          const view = ctx.get(editorViewCtx);
          if (!canEdit(view)) return;
          const reference = fileReferenceAt(view.state.doc, from);
          // Hidden Markdown delimiters have no usable DOM coordinates.
          // Anchor the edit tooltip to the visible label, keeping the full range for apply.
          if (reference && reference.to === to)
            api.editLink(mark, reference.labelFrom, reference.labelTo);
          else api.editLink(mark, from, to);
        },
        removeLink: (from, to) => {
          const view = ctx.get(editorViewCtx);
          if (!canEdit(view)) return;
          const reference = fileReferenceAt(view.state.doc, from);
          if (reference && reference.to === to) {
            view.dispatch(
              view.state.tr.replaceWith(
                from,
                to,
                view.state.doc.slice(reference.labelFrom, reference.labelTo).content
              )
            );
          } else api.removeLink(from, to);
        },
      }));

      let preview: PreviewView | undefined;
      let previewElement: HTMLElement | null = null;
      let editElement: HTMLElement | null = null;
      let hoveredLink: HTMLAnchorElement | null = null;
      let hideTimer: ReturnType<typeof setTimeout> | undefined;
      const clearHideTimer = () => clearTimeout(hideTimer);
      const hidePreview = () => {
        clearHideTimer();
        preview?.hide();
        if (previewElement) previewElement.dataset.show = 'false';
        hoveredLink = null;
      };
      const closeEdit = () => {
        if (editElement?.dataset.show !== 'true') return;
        editElement
          .querySelector('input')
          ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      };
      const hideAll = () => {
        hidePreview();
        closeEdit();
      };
      dismiss = hideAll;
      const anchorAt = (view: EditorView, target: EventTarget | null) => {
        const anchor =
          target instanceof Element ? target.closest('a[href], a[data-voex-file-reference]') : null;
        return anchor instanceof HTMLAnchorElement && view.dom.contains(anchor) ? anchor : null;
      };
      const showPreview = (view: EditorView, anchor: HTMLAnchorElement) => {
        clearHideTimer();
        if (view.isDestroyed || ctx.get(linkTooltipState.key).mode === 'edit') return;
        if (hoveredLink === anchor && previewElement?.dataset.show === 'true') return;
        const range = linkRange(view.state.doc, view.posAtDOM(anchor, 0));
        if (!range || !preview) return;
        hoveredLink = anchor;
        preview.show(range.mark, range.from, range.to, anchor.getBoundingClientRect());
        if (previewElement) {
          previewElement.dataset.readonly = String(!canEdit(view));
          if (isFileReference(range.mark.attrs.href)) {
            queueMicrotask(() => {
              if (hoveredLink !== anchor) return;
              const display = previewElement?.querySelector('.link-display');
              display?.removeAttribute('href');
              display?.setAttribute('tabindex', '0');
            });
          }
          previewElement
            .querySelector('.link-display')
            ?.setAttribute('title', range.mark.attrs.href);
        }
      };
      const scheduleHide = () => {
        clearHideTimer();
        hideTimer = setTimeout(() => {
          if (previewElement?.matches(':hover') || previewElement?.contains(document.activeElement))
            return;
          hidePreview();
        }, 150);
      };
      const openLink = (view: EditorView, event: MouseEvent) => {
        const anchor = anchorAt(view, event.target);
        if (!anchor) return false;
        if (anchor.hasAttribute('data-voex-file-reference')) {
          event.preventDefault();
          return true;
        }
        if (canEdit(view) && !event.ctrlKey && !event.metaKey) return false;
        event.preventDefault();
        const url = safeUrl(anchor.getAttribute('href') ?? '', view.dom.ownerDocument);
        if (url) view.dom.ownerDocument.defaultView?.open(url, '_blank', 'noopener,noreferrer');
        else options.notify('链接地址无效，无法打开', 'error');
        hidePreview();
        return true;
      };
      const selectForCopy = (element: HTMLAnchorElement) => {
        const document = element.ownerDocument;
        element.focus();
        const selection = document.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection?.removeAllRanges();
        selection?.addRange(range);
        options.notify('已选中链接，请按 Ctrl/Cmd + C 复制', 'info');
      };
      const copyLink = async () => {
        const anchor = previewElement?.querySelector<HTMLAnchorElement>('.link-display');
        if (!anchor) return;
        try {
          if (!navigator.clipboard) return selectForCopy(anchor);
          await navigator.clipboard.writeText(anchor.textContent ?? '');
          options.notify('链接已复制', 'success');
        } catch {
          if (anchor.isConnected) selectForCopy(anchor);
        }
      };
      const enhance = (view: EditorView, element: HTMLElement, editing: boolean) => {
        const controller = new AbortController();
        const { signal } = controller;
        element.classList.add('milkdown-editor__link-popover');
        element.setAttribute('role', 'dialog');
        element.setAttribute('aria-label', editing ? '编辑链接' : '链接预览');
        const input = element.querySelector('input');
        input?.setAttribute('aria-label', '链接地址');
        input?.setAttribute('autocomplete', 'off');
        input?.setAttribute('spellcheck', 'false');
        const confirmReference = () => {
          if (!input || !canEdit(view)) return false;
          const { from: selectionFrom, to } = view.state.selection;
          const reference = fileReferenceAt(view.state.doc, selectionFrom);
          if (!isFileReference(input.value) && !reference) return false;
          if (!validate()) return true;
          const href = input.value.trim();
          const type = view.state.schema.marks.link!;
          const transaction = view.state.tr;
          let from = selectionFrom;
          let end = to;
          if (reference && reference.labelFrom === from && reference.labelTo === to) {
            const content = view.state.doc.slice(reference.labelFrom, reference.labelTo).content;
            from = reference.from;
            transaction.replaceWith(from, reference.to, content);
            end = from + content.size;
          } else if (from === to) {
            transaction.insertText(href, from);
            end = from + href.length;
          }
          transaction.removeMark(from, end, type).addMark(from, end, type.create({ href }));
          closeEdit();
          view.dispatch(transaction);
          view.focus();
          return true;
        };
        element.addEventListener(
          'pointerdown',
          (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest('.link-icon')) {
              event.preventDefault();
              event.stopImmediatePropagation();
              void copyLink();
            } else if (editing && target?.closest('.confirm') && confirmReference()) {
              event.preventDefault();
              event.stopImmediatePropagation();
            } else if (target?.closest('.confirm, .link-edit-button, .link-remove-button')) {
              if (!canEdit(view) || (editing && !validate())) {
                event.preventDefault();
                event.stopImmediatePropagation();
              }
            }
          },
          { capture: true, signal }
        );
        const validate = () => {
          if (
            !input ||
            isFileReference(input.value) ||
            safeUrl(input.value, view.dom.ownerDocument)
          )
            return true;
          input.setAttribute('aria-invalid', 'true');
          options.notify('请输入有效的网页、邮件、电话链接或文件路径', 'error');
          input.focus();
          return false;
        };
        element.addEventListener('input', () => input?.removeAttribute('aria-invalid'), { signal });
        // 官方图标绑定 pointerdown；原生 button 的键盘 click 复用同一动作。
        element.addEventListener(
          'click',
          (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const button = target?.closest('button');
            if (button && event.detail === 0) {
              event.preventDefault();
              button.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
              );
            }
            const anchor = target?.closest('a');
            if (anchor && !editing && isFileReference(anchor.textContent)) {
              event.preventDefault();
              return;
            }
            if (anchor && !safeUrl(anchor.getAttribute('href') ?? '', view.dom.ownerDocument)) {
              event.preventDefault();
              options.notify('链接地址无效，无法打开', 'error');
            }
          },
          { signal }
        );
        element.addEventListener(
          'keydown',
          (event) => {
            if (editing && event.isComposing && ['Enter', 'Escape'].includes(event.key)) {
              event.stopImmediatePropagation();
              return;
            }
            if (editing && event.key === 'Escape' && event.target !== input) {
              event.preventDefault();
              event.stopPropagation();
              closeEdit();
            }
            if (editing && event.key === 'Enter' && confirmReference()) {
              event.preventDefault();
              event.stopImmediatePropagation();
              return;
            }
            if (editing && event.key === 'Enter' && (!canEdit(view) || !validate())) {
              event.preventDefault();
              event.stopImmediatePropagation();
            }
            if (!editing && event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              hidePreview();
              view.focus();
            }
          },
          { capture: true, signal }
        );
        element.addEventListener('mouseenter', clearHideTimer, { signal });
        element.addEventListener('mouseleave', scheduleHide, { signal });
        element.addEventListener('focusout', scheduleHide, { signal });
        return () => controller.abort();
      };

      ctx.update(linkPreviewTooltip.key, (spec) => ({
        ...spec,
        props: {
          ...spec.props,
          handleDOMEvents: {
            mousemove: (view, event) => {
              const anchor = anchorAt(view, event.target);
              if (anchor) showPreview(view, anchor);
              else scheduleHide();
              return false;
            },
            mouseleave: () => {
              scheduleHide();
              return false;
            },
            focusin: (view, event) => {
              const anchor = anchorAt(view, event.target);
              if (anchor) showPreview(view, anchor);
              return false;
            },
            mousedown: (view, event) => {
              if (
                anchorAt(view, event.target) &&
                (!canEdit(view) || event.ctrlKey || event.metaKey)
              ) {
                event.preventDefault();
                return true;
              }
              return false;
            },
            click: openLink,
            auxclick: (view, event) => {
              const anchor = anchorAt(view, event.target);
              if (!anchor?.hasAttribute('data-voex-file-reference')) return false;
              event.preventDefault();
              return true;
            },
            keydown: (view, event) => {
              const anchor = anchorAt(view, event.target);
              if (anchor && event.key === 'Enter' && !event.isComposing) {
                event.preventDefault();
                if (anchor.hasAttribute('data-voex-file-reference')) return true;
                const url = safeUrl(anchor.getAttribute('href') ?? '', view.dom.ownerDocument);
                if (url)
                  view.dom.ownerDocument.defaultView?.open(url, '_blank', 'noopener,noreferrer');
                return true;
              }
              if (event.key === 'Escape') hidePreview();
              return false;
            },
          },
        },
        view(view) {
          const instance = spec.view!(view) as PreviewView;
          preview = instance;
          previewElement = view.dom.parentElement!.querySelector('.milkdown-link-preview');
          const disposeUI = previewElement ? enhance(view, previewElement, false) : () => {};
          const controller = new AbortController();
          const { signal } = controller;
          const document = view.dom.ownerDocument;
          document.addEventListener(
            'pointerdown',
            (event) => {
              const target = event.target;
              if (
                target instanceof Node &&
                !previewElement?.contains(target) &&
                !hoveredLink?.contains(target)
              )
                hidePreview();
            },
            { capture: true, signal }
          );
          document.addEventListener(
            'scroll',
            (event) => {
              const target = event.target;
              if (
                target instanceof Node &&
                (editElement?.contains(target) || previewElement?.contains(target))
              )
                return;
              hideAll();
            },
            { capture: true, passive: true, signal }
          );
          document.defaultView?.addEventListener('blur', hideAll, { signal });
          document.defaultView?.addEventListener('resize', hideAll, { signal });
          return {
            update(current, previous) {
              instance.update?.(current, previous);
              if (!current.state.doc.eq(previous.doc)) hideAll();
              if (previewElement) previewElement.dataset.readonly = String(!canEdit(current));
            },
            destroy() {
              controller.abort();
              disposeUI();
              clearHideTimer();
              instance.destroy?.();
              preview = undefined;
              previewElement = null;
              dismiss = undefined;
            },
          };
        },
      }));
      ctx.update(linkEditTooltip.key, (spec) => ({
        ...spec,
        view(view) {
          const instance = spec.view!(view);
          editElement = view.dom.parentElement!.querySelector('.milkdown-link-edit');
          const disposeUI = editElement ? enhance(view, editElement, true) : () => {};
          return {
            update: (current, previous) => instance.update?.(current, previous),
            destroy() {
              disposeUI();
              instance.destroy?.();
              editElement = null;
            },
          };
        },
      }));
    },
  };
}
