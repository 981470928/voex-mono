import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { closeHistory } from '@milkdown/kit/prose/history';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView, NodeView } from '@milkdown/kit/prose/view';
import type { CardViewContext } from './card-list';
import {
  CARD_LIST,
  CARD_ITEM,
  MIN_CARD_IMAGE_SIZE,
  MAX_CARD_IMAGE_SIZE,
  MIN_CARD_IMAGE_HEIGHT,
  MAX_CARD_IMAGE_HEIGHT,
  MAX_CARD_PADDING,
  cardAncestor,
  cardImageSize,
  cardImageHeight,
  cardImageFit,
  cardPadding,
  emptyCard,
  safeCardImage,
  type CardLayout,
} from './card-list-model';

type GetPos = () => number | undefined;
function button(doc: Document, label: string, icon?: string) {
  const element = doc.createElement('button');
  element.type = 'button';
  element.className = 'milkdown-cards__button';
  element.title = label;
  element.setAttribute('aria-label', label);
  if (icon) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const use = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${icon}`);
    svg.append(use);
    element.append(svg);
  } else element.textContent = label;
  element.onmousedown = (event) => event.preventDefault();
  return element;
}

export function createCardListView(
  initial: ProseNode,
  view: EditorView,
  getPos: GetPos,
  options: CardViewContext
): NodeView {
  const doc = view.dom.ownerDocument;
  const win = doc.defaultView!;
  let node = initial;
  let selected = false;
  let focused = false;
  let windowFocused = true;
  let destroyed = false;
  let watching = false;
  let positionFrame = 0;
  const canEdit = () => !destroyed && !view.isDestroyed && !options.readonly();
  const dom = doc.createElement('section');
  dom.className = 'milkdown-cards';
  dom.dataset.type = CARD_LIST;
  dom.setAttribute('role', 'group');
  dom.setAttribute('aria-label', '卡片列表，按 Enter 选中整个组件');
  const tools = doc.createElement('div');
  tools.className = 'milkdown-cards__tools';
  tools.contentEditable = 'false';
  tools.dataset.minimapIgnore = '';
  tools.setAttribute('role', 'group');
  tools.setAttribute('aria-label', '卡片列表设置');
  tools.hidden = true;
  const select = button(doc, '选中整个卡片列表', 'grid');
  const title = doc.createElement('span');
  title.className = 'milkdown-cards__title';
  const add = button(doc, '添加卡片', 'add');
  const controls = doc.createElement('div');
  controls.className = 'milkdown-cards__controls';
  const horizontal = button(doc, '横向布局', 'grid');
  const vertical = button(doc, '纵向布局', 'list');
  const feedback = doc.createElement('span');
  feedback.className = 'milkdown-cards__validation';
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  type SizeAttribute = 'imageSize' | 'imageHeight' | 'padding';
  const currentValue = (attribute: SizeAttribute) =>
    attribute === 'imageHeight'
      ? cardImageHeight(node.attrs.imageHeight)
      : Number(node.attrs[attribute]);
  const fields = [
    {
      attribute: 'imageSize' as const,
      label: '图片宽',
      accessible: '所有卡片的图片宽度（像素）',
      min: MIN_CARD_IMAGE_SIZE,
      max: MAX_CARD_IMAGE_SIZE,
    },
    {
      attribute: 'imageHeight' as const,
      label: '图片高',
      accessible: '所有卡片的图片高度（像素）',
      min: MIN_CARD_IMAGE_HEIGHT,
      max: MAX_CARD_IMAGE_HEIGHT,
    },
    {
      attribute: 'padding' as const,
      label: '内边距',
      accessible: '卡片列表内边距（像素）',
      min: 0,
      max: MAX_CARD_PADDING,
    },
  ].map((field) => {
    const label = doc.createElement('label');
    label.className = 'milkdown-cards__field';
    label.append(field.label);
    const input = doc.createElement('input');
    input.type = 'number';
    input.min = String(field.min);
    input.max = String(field.max);
    input.step = '1';
    input.inputMode = 'numeric';
    input.setAttribute('aria-label', field.accessible);
    const unit = doc.createElement('span');
    unit.textContent = 'px';
    unit.className = 'milkdown-cards__unit';
    label.append(input, unit);
    return { ...field, input, element: label, composing: false };
  });
  const fitLabel = doc.createElement('label');
  fitLabel.className = 'milkdown-cards__field';
  fitLabel.append('图片模式');
  const fit = doc.createElement('select');
  fit.setAttribute('aria-label', '卡片图片展示模式');
  for (const [value, label] of [
    ['cover', 'Cover · 裁切铺满'],
    ['contain', 'Contain · 完整显示'],
  ]) {
    const option = doc.createElement('option');
    option.value = value!;
    option.textContent = label!;
    fit.append(option);
  }
  fitLabel.append(fit);
  controls.append(horizontal, vertical, ...fields.map((field) => field.element), fitLabel);
  tools.append(select, title, controls, add, feedback);
  const contentDOM = doc.createElement('div');
  contentDOM.className = 'milkdown-cards__items';
  dom.append(tools, contentDOM);

  function selectList() {
    const pos = getPos();
    if (!canEdit() || pos === undefined) return;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.focus();
    syncFocus();
  }
  function updateAttributes(patch: Record<string, string | number>) {
    const pos = getPos();
    if (!canEdit() || !selected || pos === undefined) return;
    if (Object.entries(patch).every(([key, value]) => node.attrs[key] === value)) return;
    const tr = closeHistory(view.state.tr).setNodeMarkup(pos, undefined, {
      ...node.attrs,
      ...patch,
    });
    view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
  }
  select.onclick = selectList;
  horizontal.onclick = () => updateAttributes({ layout: 'horizontal' satisfies CardLayout });
  vertical.onclick = () => updateAttributes({ layout: 'vertical' satisfies CardLayout });
  add.onclick = () => {
    const pos = getPos();
    if (!canEdit() || pos === undefined) return;
    const end = pos + node.nodeSize - 1;
    const tr = closeHistory(view.state.tr).insert(end, emptyCard(view.state.schema));
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 2)).scrollIntoView());
    view.focus();
  };
  function applyDimensions() {
    dom.style.setProperty('--card-image-width', `${cardImageSize(node.attrs.imageSize)}px`);
    dom.style.setProperty('--card-image-height', `${cardImageHeight(node.attrs.imageHeight)}px`);
    dom.style.setProperty('--card-image-fit', cardImageFit(node.attrs.imageFit));
    dom.style.setProperty('--card-padding', `${cardPadding(node.attrs.padding)}px`);
  }
  function validateField(field: (typeof fields)[number]): number | null {
    const value = Number(field.input.value);
    const valid =
      /^\d+$/.test(field.input.value) &&
      Number.isInteger(value) &&
      value >= field.min &&
      value <= field.max;
    field.input.setAttribute('aria-invalid', String(!valid));
    feedback.hidden = valid;
    if (!valid) feedback.textContent = `${field.label}请输入 ${field.min}–${field.max} 的整数像素`;
    return valid ? value : null;
  }
  function commitField(field: (typeof fields)[number]) {
    if (!canEdit() || !selected || field.composing) return;
    const value = validateField(field);
    if (value === null) {
      applyDimensions();
      return;
    }
    const patch: Record<string, number> = { [field.attribute]: value };
    updateAttributes(patch);
  }
  for (const field of fields) {
    field.input.addEventListener('compositionstart', () => {
      field.composing = true;
    });
    field.input.addEventListener('compositionend', () => {
      field.composing = false;
      commitField(field);
    });
    field.input.oninput = (event) => {
      if (!canEdit() || !selected || field.composing || (event as InputEvent).isComposing) return;
      const value = validateField(field);
      if (value === null) return;
      const property = {
        imageSize: '--card-image-width',
        imageHeight: '--card-image-height',
        padding: '--card-padding',
      }[field.attribute];
      dom.style.setProperty(property, `${value}px`);
      schedulePosition();
    };
    field.input.onchange = () => commitField(field);
    field.input.onkeydown = (event) => {
      if (event.key === 'Enter' && !event.isComposing && !field.composing) {
        event.preventDefault();
        commitField(field);
      }
    };
  }
  fit.onchange = () => updateAttributes({ imageFit: cardImageFit(fit.value) });
  tools.onkeydown = (event) => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    feedback.hidden = true;
    for (const field of fields) {
      field.input.value = String(currentValue(field.attribute));
      field.input.removeAttribute('aria-invalid');
    }
    applyDimensions();
    view.focus();
  };
  dom.onmousedown = (event) => {
    if (event.target !== dom && event.target !== contentDOM) return;
    event.preventDefault();
    selectList();
  };
  dom.onkeydown = (event) => {
    if (event.target !== dom || event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    selectList();
  };

  function positionControls() {
    if (!focused || !canEdit()) {
      tools.hidden = true;
      return;
    }
    const rect = dom.getBoundingClientRect();
    const viewport = win.visualViewport;
    let left = viewport?.offsetLeft ?? 0;
    let top = viewport?.offsetTop ?? 0;
    let right = left + (viewport?.width ?? doc.documentElement.clientWidth);
    let bottom = top + (viewport?.height ?? win.innerHeight);
    for (let parent = dom.parentElement; parent; parent = parent.parentElement) {
      const style = win.getComputedStyle(parent);
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
      tools.hidden = true;
      return;
    }
    tools.hidden = false;
    tools.style.maxWidth = `${Math.max(0, right - left - 16)}px`;
    const bounds = tools.getBoundingClientRect();
    tools.style.left = `${Math.max(left + 8, Math.min(rect.left, right - bounds.width - 8))}px`;
    const above = rect.top - bounds.height - 8;
    tools.style.top = `${Math.max(top + 8, Math.min(above >= top + 8 ? above : rect.bottom + 8, bottom - bounds.height - 8))}px`;
  }
  function schedulePosition() {
    if (destroyed || positionFrame) return;
    positionFrame = win.requestAnimationFrame(() => {
      positionFrame = 0;
      if (!destroyed) positionControls();
    });
  }
  const observer = new ResizeObserver(schedulePosition);
  function watchPosition(enabled: boolean) {
    if (watching === enabled) return;
    watching = enabled;
    if (enabled) {
      win.addEventListener('scroll', schedulePosition, true);
      win.addEventListener('resize', schedulePosition);
      win.visualViewport?.addEventListener('resize', schedulePosition);
      win.visualViewport?.addEventListener('scroll', schedulePosition);
      observer.observe(dom);
      observer.observe(tools);
    } else {
      win.removeEventListener('scroll', schedulePosition, true);
      win.removeEventListener('resize', schedulePosition);
      win.visualViewport?.removeEventListener('resize', schedulePosition);
      win.visualViewport?.removeEventListener('scroll', schedulePosition);
      observer.disconnect();
    }
  }
  function syncFocus() {
    if (destroyed || view.isDestroyed) return;
    const pos = getPos();
    const selection = view.state.selection;
    const selectionInside =
      pos !== undefined &&
      (selection instanceof NodeSelection
        ? selection.from === pos && selection.node === node
        : selection.from > pos && selection.to < pos + node.nodeSize);
    focused =
      windowFocused &&
      canEdit() &&
      (dom.contains(doc.activeElement) || (view.hasFocus() && selectionInside));
    tools.hidden = !focused;
    watchPosition(focused);
    if (focused) schedulePosition();
  }
  const focusChanged = () =>
    queueMicrotask(() => {
      if (!destroyed) syncFocus();
    });
  const windowFocusedAgain = () => {
    windowFocused = true;
    focusChanged();
  };
  const windowBlurred = () => {
    windowFocused = false;
    focused = false;
    tools.hidden = true;
    watchPosition(false);
  };
  doc.addEventListener('focusin', focusChanged);
  doc.addEventListener('focusout', focusChanged);
  win.addEventListener('focus', windowFocusedAgain);
  win.addEventListener('blur', windowBlurred);
  function refresh() {
    const editable = canEdit();
    dom.tabIndex = editable ? 0 : -1;
    dom.setAttribute('aria-label', editable ? '卡片列表，按 Enter 选中整个组件' : '卡片列表');
    dom.dataset.layout = node.attrs.layout;
    dom.dataset.imageSize = String(node.attrs.imageSize);
    dom.dataset.imageHeight = String(cardImageHeight(node.attrs.imageHeight));
    dom.dataset.imageFit = cardImageFit(node.attrs.imageFit);
    dom.dataset.padding = String(cardPadding(node.attrs.padding));
    dom.dataset.readonly = String(!editable);
    dom.classList.toggle('milkdown-cards--selected', selected && editable);
    applyDimensions();
    select.disabled = !editable;
    select.setAttribute('aria-pressed', String(selected));
    title.textContent = `卡片列表 · ${node.childCount}`;
    add.disabled = !editable;
    horizontal.disabled = vertical.disabled = !selected || !editable;
    horizontal.setAttribute('aria-pressed', String(node.attrs.layout === 'horizontal'));
    vertical.setAttribute('aria-pressed', String(node.attrs.layout === 'vertical'));
    for (const field of fields) {
      field.input.disabled = !selected || !editable;
      field.input.title = selected ? `${field.min}–${field.max}px` : '选中整个组件后调整';
      if (doc.activeElement !== field.input || !editable)
        field.input.value = String(currentValue(field.attribute));
    }
    fit.disabled = !selected || !editable;
    fit.title = selected ? '图片展示模式' : '选中整个组件后调整';
    if (doc.activeElement !== fit || !editable) fit.value = cardImageFit(node.attrs.imageFit);
    if (!editable) feedback.hidden = true;
    syncFocus();
  }
  options.refreshers.add(refresh);
  options.selectionRefreshers.add(syncFocus);
  refresh();
  queueMicrotask(() => {
    if (!destroyed) refresh();
  });
  return {
    dom,
    contentDOM,
    update(next) {
      if (next.type !== node.type) return false;
      node = next;
      refresh();
      return true;
    },
    selectNode() {
      selected = true;
      refresh();
    },
    deselectNode() {
      selected = false;
      refresh();
    },
    stopEvent: (event) =>
      event.target instanceof Node && (tools.contains(event.target) || event.target === dom),
    ignoreMutation: (mutation) =>
      mutation.type !== 'selection' && !contentDOM.contains(mutation.target),
    destroy() {
      destroyed = true;
      options.refreshers.delete(refresh);
      options.selectionRefreshers.delete(syncFocus);
      watchPosition(false);
      if (positionFrame) win.cancelAnimationFrame(positionFrame);
      doc.removeEventListener('focusin', focusChanged);
      doc.removeEventListener('focusout', focusChanged);
      win.removeEventListener('focus', windowFocusedAgain);
      win.removeEventListener('blur', windowBlurred);
    },
  };
}

export function createCardItemView(
  initial: ProseNode,
  view: EditorView,
  getPos: GetPos,
  options: CardViewContext
): NodeView {
  const doc = view.dom.ownerDocument;
  let node = initial;
  let destroyed = false;
  let busy = false;
  let feedbackMessage = '';
  let loading = false;
  let failed = false;
  let source: string | undefined;
  let loadVersion = 0;
  let operation = 0;
  const canEdit = () => !destroyed && !view.isDestroyed && !options.readonly();
  const dom = doc.createElement('div');
  dom.className = 'milkdown-card';
  dom.dataset.type = CARD_ITEM;
  const media = doc.createElement('div');
  media.className = 'milkdown-card__media';
  media.contentEditable = 'false';
  const image = doc.createElement('img');
  image.className = 'milkdown-card__image';
  image.draggable = false;
  const feedback = doc.createElement('span');
  feedback.className = 'milkdown-card__feedback';
  feedback.setAttribute('role', 'status');
  const upload = button(doc, '点击或者拖拽文档中的图片添加', 'image');
  upload.classList.add('milkdown-card__upload');
  const hint = doc.createElement('span');
  hint.textContent = '点击或者拖拽文档中的图片添加';
  upload.append(hint);
  const actions = doc.createElement('div');
  actions.className = 'milkdown-card__actions';
  const remove = button(doc, '移除图片', 'trash');
  const replace = button(doc, '替换图片', 'refresh');
  actions.append(remove, replace);
  const picker = doc.createElement('input');
  picker.type = 'file';
  picker.accept = 'image/*';
  picker.hidden = true;
  const removeCard = button(doc, '删除卡片', 'close');
  removeCard.classList.add('milkdown-card__remove');
  removeCard.contentEditable = 'false';
  removeCard.dataset.minimapIgnore = '';
  media.append(image, upload, actions, feedback, picker);
  const contentDOM = doc.createElement('div');
  contentDOM.className = 'milkdown-card__body';
  dom.append(media, contentDOM, removeCard);
  const feedbackError = (message: string) => {
    feedbackMessage = message;
    feedback.textContent = message;
    feedback.hidden = false;
    options.onError(message);
  };
  function setImage(src: string, alt: string) {
    const pos = getPos();
    if (!canEdit() || pos === undefined) return;
    view.dispatch(
      closeHistory(view.state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, src, alt })
    );
  }
  function chooseFile() {
    if (!canEdit() || busy) return;
    picker.value = '';
    picker.click();
  }
  upload.onclick = chooseFile;
  replace.onclick = chooseFile;
  remove.onclick = () => {
    if (canEdit() && !busy) {
      operation++;
      feedbackMessage = '';
      setImage('', '');
      upload.focus();
    }
  };
  removeCard.onclick = () => {
    const pos = getPos();
    if (!canEdit() || pos === undefined) return;
    const parent = cardAncestor(view.state.doc.resolve(pos));
    if (!parent) return;
    const tr = closeHistory(view.state.tr);
    if (parent.node.childCount === 1)
      tr.replaceWith(
        parent.pos,
        parent.pos + parent.node.nodeSize,
        view.state.schema.nodes.paragraph!.create()
      );
    else tr.delete(pos, pos + node.nodeSize);
    view.dispatch(
      tr
        .setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))))
        .scrollIntoView()
    );
    view.focus();
  };
  async function importImage(
    files: File[] | null,
    dragged: ProseNode | null,
    replaceExisting: boolean,
    moveSource?: { node: ProseNode; bookmark: ReturnType<NodeSelection['getBookmark']> }
  ) {
    if (!canEdit() || busy || (!replaceExisting && node.attrs.src)) return;
    if (files && (files.length !== 1 || !files[0]!.type.startsWith('image/'))) {
      feedbackError('每张卡片只能添加一张图片，请选择图片文件');
      return;
    }
    const initialSource = node.attrs.src;
    const current = ++operation;
    const epoch = options.epoch();
    const key = Symbol('card-image-source');
    if (moveSource) options.sources.set(key, moveSource);
    busy = true;
    feedbackMessage = '';
    refresh();
    try {
      const imported = files
        ? (await options.imageImport.importImages(view, files))[0]
        : dragged
          ? await options.imageImport.importSource(view, dragged)
          : null;
      const pos = getPos();
      if (
        !imported ||
        !canEdit() ||
        current !== operation ||
        epoch !== options.epoch() ||
        pos === undefined ||
        node.attrs.src !== initialSource
      )
        return;
      const src = safeCardImage(imported.attrs.src);
      if (!src) throw new Error('图片地址无效，请重新上传');
      const tr = closeHistory(view.state.tr).setNodeMarkup(pos, undefined, {
        ...node.attrs,
        src,
        alt: imported.attrs.alt ?? '',
      });
      const origin = options.sources.get(key);
      if (origin) {
        const selected = origin.bookmark.resolve(view.state.doc);
        if (selected instanceof NodeSelection && selected.node === origin.node)
          tr.delete(selected.from, selected.to);
      }
      view.dispatch(tr.scrollIntoView());
    } catch (cause) {
      if (canEdit() && current === operation && epoch === options.epoch())
        feedbackError(cause instanceof Error ? cause.message : '图片上传失败，请重试');
    } finally {
      options.sources.delete(key);
      if (!destroyed && current === operation) {
        busy = false;
        refresh();
      }
    }
  }
  picker.onchange = () => {
    const files = Array.from(picker.files ?? []);
    if (files.length) void importImage(files, null, true);
  };
  const copiesImage = (event: DragEvent) =>
    /Mac|iP/.test(doc.defaultView!.navigator.platform) ? event.altKey : event.ctrlKey;
  media.ondragover = (event) => {
    if (!canEdit()) return;
    event.preventDefault();
    event.stopPropagation();
    const allowed = !node.attrs.src && !busy;
    if (event.dataTransfer)
      event.dataTransfer.dropEffect = allowed
        ? view.dragging && !copiesImage(event)
          ? 'move'
          : 'copy'
        : 'none';
    media.classList.toggle('milkdown-card__media--dragover', allowed);
  };
  media.ondragleave = (event) => {
    if (!(event.relatedTarget instanceof Node) || !media.contains(event.relatedTarget))
      media.classList.remove('milkdown-card__media--dragover');
  };
  media.ondrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    media.classList.remove('milkdown-card__media--dragover');
    const dragging = view.dragging;
    view.dragging = null;
    if (!canEdit() || busy) return;
    if (node.attrs.src) {
      feedbackError('请先移除图片，再拖入新图片');
      return;
    }
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length && !dragging) {
      void importImage(files, null, false);
      return;
    }
    const images: ProseNode[] = [];
    let otherContent = false;
    dragging?.slice.content.descendants((child) => {
      if (child.type.name === 'image') images.push(child);
      else if (child.isLeaf) otherContent = true;
    });
    if (images.length !== 1 || otherContent) {
      feedbackError('请拖拽文档中的一张图片，或点击上传');
      return;
    }
    const selected = view.state.selection;
    const origin =
      dragging &&
      !copiesImage(event) &&
      selected instanceof NodeSelection &&
      selected.node === images[0]
        ? { node: selected.node, bookmark: selected.getBookmark() }
        : undefined;
    void importImage(null, images[0]!, false, origin);
  };
  image.onload = () => {
    if (!destroyed) {
      loading = false;
      failed = false;
      refresh();
    }
  };
  image.onerror = () => {
    if (!destroyed) {
      loading = false;
      failed = true;
      refresh();
    }
  };
  function refresh() {
    const editable = canEdit();
    const src = safeCardImage(node.attrs.src);
    const filled = Boolean(src);
    dom.dataset.src = src;
    dom.dataset.alt = node.attrs.alt;
    media.dataset.filled = String(filled);
    media.setAttribute('aria-busy', String(busy || loading));
    image.alt = node.attrs.alt || '卡片图片';
    if (source !== src) {
      source = src;
      const version = ++loadVersion;
      loading = filled;
      failed = false;
      image.removeAttribute('src');
      if (src)
        void options.imageImport
          .resolveSource(src)
          .then((url) => {
            if (!destroyed && version === loadVersion) image.src = url;
          })
          .catch(() => {
            if (!destroyed && version === loadVersion) {
              loading = false;
              failed = true;
              refresh();
            }
          });
    }
    image.hidden = !filled || loading || failed;
    upload.hidden = filled || !editable || busy;
    upload.disabled = !editable || busy;
    actions.hidden = !filled || !editable;
    remove.disabled = replace.disabled = !editable || busy;
    removeCard.hidden = !editable;
    removeCard.disabled = !editable;
    feedback.hidden = !busy && !loading && !failed && !feedbackMessage;
    feedback.textContent = busy
      ? '正在导入图片…'
      : loading
        ? '正在加载图片…'
        : failed
          ? '图片加载失败，可替换后重试'
          : feedbackMessage;
  }
  options.refreshers.add(refresh);
  refresh();
  queueMicrotask(() => {
    if (!destroyed) refresh();
  });
  return {
    dom,
    contentDOM,
    update(next) {
      if (next.type !== node.type) return false;
      node = next;
      refresh();
      return true;
    },
    stopEvent: (event) =>
      event.target instanceof Node &&
      (media.contains(event.target) || removeCard.contains(event.target)),
    ignoreMutation: (mutation) =>
      mutation.type !== 'selection' && !contentDOM.contains(mutation.target),
    destroy() {
      destroyed = true;
      operation++;
      loadVersion++;
      options.refreshers.delete(refresh);
      image.onload = image.onerror = null;
    },
  };
}
