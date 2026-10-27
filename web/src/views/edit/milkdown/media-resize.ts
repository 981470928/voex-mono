import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { closeHistory } from '@milkdown/kit/prose/history';
import { NodeSelection } from '@milkdown/kit/prose/state';
import type { EditorView, NodeView } from '@milkdown/kit/prose/view';
import {
  MIN_WIDTH,
  MAX_WIDTH,
  parseAlignment,
  parseWidth,
  type ImageAlignment,
} from '@voex/editor-schema/images';
import {
  ATTACHMENT_NODE_ID,
  attachmentMediaKind,
  getNodeAttrs,
  isExpandedMedia,
} from '@voex/editor-schema/attachment';
import { createAttachmentMedia, type AttachmentMediaOptions } from './attachment-media';

let mediaViewId = 0;

/** Shares image control styles, layout validation and sizing/positioning behavior. */
export function createResizableMediaView(
  initialNode: ProseMirrorNode,
  view: EditorView,
  getPos: () => number | undefined,
  isAvailable: (hash: string) => boolean,
  options: AttachmentMediaOptions,
  refreshers: Set<() => void>
): NodeView {
  const document = view.dom.ownerDocument;
  const window = document.defaultView!;
  let node = initialNode;
  let selected = false;
  let dismissed = false;
  let destroyed = false;
  let composing = false;
  let compositionEndedAt = -Infinity;
  let watching = false;
  let drag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        startWidth: number;
        ratio: number;
        horizontal: number;
        width: number;
        maxWidth: number;
      }
    | undefined;
  const canEdit = () => !destroyed && !view.isDestroyed && !options.readonly();
  const dom = document.createElement('div');
  dom.className = 'milkdown-editor__image milkdown-editor__media';
  dom.dataset.type = ATTACHMENT_NODE_ID;
  const kind = attachmentMediaKind(String(node.attrs.mime))!;
  const mediaLabel = kind === 'video' ? '视频' : '音频';
  dom.dataset.kind = kind;
  const playback = createAttachmentMedia({
    ...options,
    onStateChange: () => {
      options.onStateChange?.();
      refresh();
    },
  });
  function mediaRatio() {
    const player = playback.getPlayer();
    return kind === 'audio'
      ? 0
      : player instanceof HTMLVideoElement && player.videoWidth
        ? player.videoHeight / player.videoWidth
        : 9 / 16;
  }
  dom.contentEditable = 'false';
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'milkdown-editor__image-handle';
  handle.title = '拖动调整宽度，或用左右方向键调整宽度';
  handle.setAttribute('aria-label', `调整${mediaLabel}大小`);
  const controls = document.createElement('span');
  controls.className = 'milkdown-editor__image-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', `${mediaLabel}尺寸与对齐`);
  const label = document.createElement('label');
  label.className = 'milkdown-editor__image-label';
  label.textContent = '宽度';
  const input = document.createElement('input');
  input.id = `voex-media-width-${++mediaViewId}`;
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = String(MIN_WIDTH);
  input.max = String(MAX_WIDTH);
  input.step = '1';
  input.setAttribute('aria-label', `${mediaLabel}宽度（像素）`);
  label.htmlFor = input.id;
  const unit = document.createElement('span');
  unit.textContent = 'px';
  label.append(input, unit);
  const iconButton = (name: string, label: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${name}`);
    svg.append(use);
    button.append(svg);
    button.onmousedown = (event) => event.preventDefault();
    return button;
  };
  const separator = () => {
    const element = document.createElement('span');
    element.className = 'milkdown-editor__image-separator';
    element.setAttribute('role', 'separator');
    element.setAttribute('aria-orientation', 'vertical');
    return element;
  };
  const alignmentGroup = document.createElement('span');
  alignmentGroup.className = 'milkdown-editor__image-alignment';
  alignmentGroup.setAttribute('role', 'group');
  alignmentGroup.setAttribute('aria-label', `${mediaLabel}对齐`);
  const alignmentButtons = (
    [
      ['left', '左对齐'],
      ['right', '右对齐'],
      ['center', '居中'],
    ] as const
  ).map(([alignment, text]) => {
    const button = iconButton(`editor-align-${alignment}`, text);
    button.onclick = () => commit({ alignment });
    alignmentGroup.append(button);
    return { alignment, button };
  });
  const error = document.createElement('span');
  error.id = `${input.id}-error`;
  error.className = 'milkdown-editor__image-validation';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const attachment = iconButton('attachment', '显示为附件');
  attachment.onclick = () => {
    const pos = getPos();
    if (canEdit() && pos !== undefined) commit({ display: 'attachment' });
  };
  controls.append(label, separator(), alignmentGroup, separator(), attachment);
  controls.dataset.minimapIgnore = '';
  handle.dataset.minimapIgnore = '';
  error.dataset.minimapIgnore = '';
  dom.append(playback.dom, handle, controls, error);

  function positionControls() {
    if (!selected || !canEdit() || dismissed || drag) {
      controls.hidden = true;
      error.hidden = true;
      return;
    }
    const rect = dom.getBoundingClientRect();
    const viewport = window.visualViewport;
    let left = viewport?.offsetLeft ?? 0,
      top = viewport?.offsetTop ?? 0,
      right = left + (viewport?.width ?? document.documentElement.clientWidth),
      bottom = top + (viewport?.height ?? window.innerHeight);
    for (let parent = dom.parentElement; parent; parent = parent.parentElement) {
      const style = window.getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, bounds.top);
        bottom = Math.min(bottom, bounds.bottom);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, bounds.left);
        right = Math.min(right, bounds.right);
      }
    }
    const toolbar = view.dom
      .closest('.milkdown-editor')
      ?.querySelector('.milkdown-editor__toolbar');
    if (toolbar?.getClientRects().length)
      top = Math.max(top, toolbar.getBoundingClientRect().bottom);
    if (rect.bottom <= top || rect.top >= bottom || rect.right <= left || rect.left >= right) {
      controls.hidden = true;
      error.hidden = true;
      return;
    }
    controls.hidden = false;
    controls.style.maxWidth = `${Math.max(0, right - left - 12)}px`;
    const height = controls.getBoundingClientRect().height;
    const width = controls.getBoundingClientRect().width;
    const centeredLeft = rect.left + (rect.width - width) / 2;
    controls.style.left = `${Math.max(left + 6, Math.min(centeredLeft, right - width - 6))}px`;
    const above = rect.top - height - 8;
    controls.style.top = `${Math.max(top + 6, Math.min(above >= top + 6 ? above : rect.bottom + 8, bottom - height - 6))}px`;
    error.hidden = !input.hasAttribute('aria-invalid');
    if (!error.hidden) {
      error.style.maxWidth = controls.style.maxWidth;
      const bounds = controls.getBoundingClientRect();
      const errorHeight = error.getBoundingClientRect().height;
      const errorTop = bounds.bottom + 4;
      error.style.left = controls.style.left;
      error.style.top = `${Math.max(top + 6, Math.min(errorTop + errorHeight <= bottom - 6 ? errorTop : bounds.top - errorHeight - 4, bottom - errorHeight - 6))}px`;
    }
  }

  const observer = new ResizeObserver(() => {
    refreshInput();
    positionControls();
  });
  function watchPosition(enabled: boolean) {
    if (watching === enabled) return;
    watching = enabled;
    if (enabled) {
      window.addEventListener('scroll', positionControls, true);
      window.addEventListener('resize', positionControls);
      window.visualViewport?.addEventListener('resize', positionControls);
      window.visualViewport?.addEventListener('scroll', positionControls);
      observer.observe(dom);
    } else {
      window.removeEventListener('scroll', positionControls, true);
      window.removeEventListener('resize', positionControls);
      window.visualViewport?.removeEventListener('resize', positionControls);
      window.visualViewport?.removeEventListener('scroll', positionControls);
      observer.disconnect();
    }
  }

  function refreshInput() {
    if (document.activeElement !== input && !composing)
      input.value = String(
        parseWidth(node.attrs.width) ?? Math.round(dom.getBoundingClientRect().width)
      );
  }

  function refresh() {
    const editable = canEdit();
    dom.tabIndex = editable ? 0 : -1;
    dom.setAttribute(
      'aria-label',
      editable
        ? `${node.attrs.name || mediaLabel}，按 Enter 调整大小`
        : node.attrs.name || mediaLabel
    );
    dom.classList.toggle('milkdown-editor__image--selected', selected && editable && !dismissed);
    dom.classList.toggle('milkdown-editor__image--resizing', Boolean(drag));
    dom.style.width = `${parseWidth(node.attrs.width) ?? 360}px`;
    const alignment = parseAlignment(node.attrs.alignment);
    if (alignment) dom.dataset.align = alignment;
    else delete dom.dataset.align;
    alignmentButtons.forEach(({ alignment: value, button }) => {
      button.setAttribute('aria-pressed', String(alignment === value));
      button.disabled = !editable;
    });
    playback.update(getNodeAttrs(node), isAvailable(String(node.attrs.hash)));
    attachment.disabled = !editable;
    handle.hidden = !selected || !editable || dismissed;
    input.disabled = !editable;
    refreshInput();
    watchPosition(selected && editable && !dismissed);
    positionControls();
  }

  function clearError() {
    error.hidden = true;
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
  function selectMedia(focus = true) {
    const pos = getPos();
    if (!canEdit() || pos === undefined) return;
    dismissed = false;
    if (!(view.state.selection instanceof NodeSelection) || view.state.selection.from !== pos)
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    if (focus) view.focus();
    refresh();
  }

  function commit(
    attrs: { width?: number; alignment?: ImageAlignment; display?: 'attachment' | 'media' },
    focus = true
  ) {
    const pos = getPos();
    if (!canEdit() || pos === undefined) return;
    const current = view.state.doc.nodeAt(pos);
    if (current?.type !== node.type || !isExpandedMedia(current)) return;
    clearError();
    if (Object.entries(attrs).some(([key, value]) => current.attrs[key] !== value)) {
      const tr = closeHistory(view.state.tr).setNodeMarkup(pos, undefined, {
        ...current.attrs,
        ...attrs,
      });
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      view.dispatch(tr);
      // 同时隔离后续正文输入，避免一次撤销连带回退媒体尺寸。
      view.dispatch(closeHistory(view.state.tr));
    }
    if (focus) view.focus();
    refresh();
  }

  function applyWidth() {
    if (composing || !canEdit()) return;
    const width = parseWidth(input.value);
    if (width === null) {
      error.textContent = `请输入 ${MIN_WIDTH}–${MAX_WIDTH} 之间的整数宽度`;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', error.id);
      positionControls();
      return;
    }
    // 保留输入焦点，连续输入和步进调整都立即更新当前媒体。
    commit({ width }, false);
  }

  function cancelResize() {
    if (!drag) return;
    const pointerId = drag.pointerId;
    drag = undefined;
    window.removeEventListener('pointermove', moveResize);
    window.removeEventListener('pointerup', finishResize);
    window.removeEventListener('pointercancel', cancelResize);
    window.removeEventListener('blur', cancelResize);
    window.removeEventListener('keydown', cancelOnEscape, true);
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    if (!destroyed) refresh();
  }
  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cancelResize();
  }
  function moveResize(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!canEdit()) {
      cancelResize();
      return;
    }
    event.preventDefault();
    // 将横向和纵向拖动投影到媒体原始比例，拖动任一方向都能等比例缩放。
    const delta =
      ((event.clientX - drag.startX) * drag.horizontal +
        (event.clientY - drag.startY) * drag.ratio) /
      (drag.horizontal ** 2 + drag.ratio ** 2);
    drag.width = Math.max(MIN_WIDTH, Math.min(drag.maxWidth, Math.round(drag.startWidth + delta)));
    dom.style.width = `${drag.width}px`;
    input.value = String(drag.width);
  }
  function finishResize(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const width = drag.width;
    const moved = width !== Math.round(drag.startWidth);
    cancelResize();
    if (moved) commit({ width });
  }

  handle.onpointerdown = (event) => {
    if (!canEdit() || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectMedia();
    clearError();
    const parent = dom.parentElement!;
    const style = window.getComputedStyle(parent);
    const maxWidth = Math.max(
      MIN_WIDTH,
      Math.floor(
        parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      )
    );
    const startWidth = dom.getBoundingClientRect().width;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth,
      ratio: mediaRatio(),
      horizontal:
        node.attrs.alignment === 'right' ? -1 : node.attrs.alignment === 'center' ? 0.5 : 1,
      width: Math.round(startWidth),
      maxWidth: Math.min(MAX_WIDTH, maxWidth),
    };
    dom.classList.add('milkdown-editor__image--resizing');
    controls.hidden = true;
    handle.setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', moveResize, { passive: false });
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', cancelResize);
    window.addEventListener('blur', cancelResize);
    window.addEventListener('keydown', cancelOnEscape, true);
  };
  handle.onkeydown = (event) => {
    if (!canEdit()) return;
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const step = (event.shiftKey ? 50 : 10) * (event.key === 'ArrowLeft' ? -1 : 1);
      commit(
        {
          width: Math.max(
            MIN_WIDTH,
            Math.min(
              MAX_WIDTH,
              (parseWidth(node.attrs.width) ?? Math.round(dom.getBoundingClientRect().width)) + step
            )
          ),
        },
        false
      );
    }
  };
  handle.onclick = () => input.focus();
  // Selecting the block must not consume clicks on the native media controls.
  dom.onpointerdown = (event) => {
    if (
      !canEdit() ||
      (event.target instanceof Node &&
        (controls.contains(event.target) || handle.contains(event.target)))
    )
      return;
    selectMedia(false);
  };
  dom.onfocus = () => selectMedia(false);
  const onFocusIn = () => {
    if (canEdit() && !selected) selectMedia(false);
  };
  dom.addEventListener('focusin', onFocusIn);
  dom.onkeydown = (event) => {
    if (
      event.key === 'Escape' &&
      selected &&
      !event.isComposing &&
      !composing &&
      !document.fullscreenElement
    ) {
      event.preventDefault();
      event.stopPropagation();
      dismissed = true;
      clearError();
      refresh();
      view.focus();
    } else if (event.target === dom && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      selectMedia(false);
      input.focus();
    }
  };
  input.oninput = applyWidth;
  const startComposition = () => {
    composing = true;
  };
  const endComposition = (event: CompositionEvent) => {
    composing = false;
    compositionEndedAt = event.timeStamp;
    applyWidth();
  };
  input.addEventListener('compositionstart', startComposition);
  input.addEventListener('compositionend', endComposition);
  input.onkeydown = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.isComposing && !composing && event.timeStamp - compositionEndedAt >= 50)
      applyWidth();
  };
  const refreshReadonly = () => {
    if (!canEdit()) cancelResize();
    refresh();
  };
  refreshers.add(refreshReadonly);
  refresh();

  return {
    dom,
    update(nextNode) {
      if (
        nextNode.type !== node.type ||
        !isExpandedMedia(nextNode) ||
        nextNode.attrs.hash !== node.attrs.hash ||
        nextNode.attrs.mime !== node.attrs.mime
      )
        return false;
      if (
        drag &&
        (nextNode.attrs.hash !== node.attrs.hash ||
          nextNode.attrs.width !== node.attrs.width ||
          nextNode.attrs.alignment !== node.attrs.alignment)
      )
        cancelResize();
      node = nextNode;
      refresh();
      return true;
    },
    selectNode() {
      selected = true;
      dismissed = false;
      refresh();
    },
    deselectNode() {
      selected = false;
      clearError();
      cancelResize();
      refresh();
    },
    stopEvent: (event) =>
      event.target instanceof Node &&
      (controls.contains(event.target) ||
        handle.contains(event.target) ||
        playback.dom.contains(event.target)),
    ignoreMutation: (mutation) => mutation.type !== 'selection',
    destroy() {
      destroyed = true;
      cancelResize();
      watchPosition(false);
      refreshers.delete(refreshReadonly);
      playback.destroy();
      dom.removeEventListener('focusin', onFocusIn);
      dom.onfocus = dom.onkeydown = dom.onpointerdown = null;
      handle.onpointerdown = handle.onkeydown = handle.onclick = null;
      input.oninput = input.onkeydown = null;
      input.removeEventListener('compositionstart', startComposition);
      input.removeEventListener('compositionend', endComposition);
      attachment.onclick = attachment.onmousedown = null;
      alignmentButtons.forEach(({ button }) => {
        button.onclick = null;
        button.onmousedown = null;
      });
    },
  };
}
