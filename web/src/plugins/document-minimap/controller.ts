import { create as createDomMinimap } from './vendor/dom-minimap';
import { createMinimapCloner, stableClassName, type MinimapPlaceholderRule } from './clone';

export type { MinimapPlaceholderRule } from './clone';

let nextSourceId = 0;

interface DocumentMinimapOptions {
  content: HTMLElement;
  host: HTMLElement;
  placeholders: MinimapPlaceholderRule[];
  ignoreSelectors: string[];
}

function scrollContainer(content: HTMLElement): HTMLElement {
  for (let parent = content.parentElement; parent; parent = parent.parentElement) {
    if (/^(auto|scroll)$/.test(window.getComputedStyle(parent).overflowY)) return parent;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

/** DOM-only controller: no editor transactions, document serialization or persistence. */
export function createDocumentMinimap(options: DocumentMinimapOptions) {
  const { content, host } = options;
  const viewport = scrollContainer(content);
  const pageScroll =
    viewport === document.scrollingElement || viewport === document.documentElement;
  const scrollTarget = pageScroll ? window : viewport;
  const dirty = new Set<Node>();
  const complexSizes = new Map<Element, { width: number; height: number }>();
  let children: Node[] = [];
  let indices = new Map<Node, number>();
  let structural = false;
  let prunePlaceholders = false;
  let disposed = false;
  let initialized = false;
  let rebuild = false;
  let width = 0;
  let timer = 0;
  let idle = 0;
  let frame = 0;
  let ariaFrame = 0;
  let builds = 0;
  let patches = 0;
  let maxScroll = 0;

  function topLevel(node: Node): Node | undefined {
    let current: Node | null = node;
    while (current?.parentNode && current.parentNode !== content) current = current.parentNode;
    return current?.parentNode === content ? current : undefined;
  }

  function markComplexBlocks() {
    for (const element of complexSizes.keys()) {
      const block = topLevel(element);
      if (block) dirty.add(block);
    }
  }

  const resizeObserver = new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      if (entry.target === content || entry.target === viewport) {
        changed = true;
        continue;
      }
      const previous = complexSizes.get(entry.target);
      if (!previous) continue;
      const rect = entry.target.getBoundingClientRect();
      if (
        Math.abs(rect.width - previous.width) < 0.5 &&
        Math.abs(rect.height - previous.height) < 0.5
      )
        continue;
      complexSizes.set(entry.target, { width: rect.width, height: rect.height });
      const block = topLevel(entry.target);
      if (block) dirty.add(block);
      changed = true;
    }
    if (changed) schedule();
  });

  const cloner = createMinimapCloner({
    ...options,
    onPlaceholder: (element, rect) => {
      if (!complexSizes.has(element)) resizeObserver.observe(element);
      complexSizes.set(element, { width: rect.width, height: rect.height });
    },
  });

  function copyTypography(clone: HTMLElement) {
    const style = window.getComputedStyle(content);
    // Keep the source CSS line-height rule: freezing a unitless value as pixels
    // changes inline-code line boxes and accumulates vertical drift in long documents.
    for (const property of [
      'font-family',
      'font-size',
      'font-weight',
      'letter-spacing',
      'text-align',
      'tab-size',
      'word-break',
      'overflow-wrap',
      'white-space',
      'color',
    ]) {
      clone.style.setProperty(property, style.getPropertyValue(property));
    }
  }

  const minimap = createDomMinimap({
    content,
    host,
    scrollElement: viewport,
    enabled: false,
    managed: true,
    position: 'absolute',
    width: host.clientWidth || 112,
    zIndex: 1,
    cloneNode: (source) => {
      const clone = cloner.cloneNode(source);
      if (source === content) {
        builds++;
        copyTypography(clone as HTMLElement);
      }
      return clone;
    },
  });
  const element = minimap.element;
  element.removeAttribute('aria-hidden');
  element.setAttribute('role', 'scrollbar');
  element.setAttribute('aria-label', '文档小地图');
  element.setAttribute('aria-orientation', 'vertical');
  element.setAttribute('aria-valuemin', '0');
  element.tabIndex = 0;
  element.title = '点击或拖拽定位；方向键、Page Up / Down、Home / End 滚动';
  // aria-controls may point at an existing editor ID, but never changes document data.
  const assignedId = !content.id;
  if (assignedId) {
    do {
      nextSourceId++;
    } while (document.getElementById(`document-minimap-source-${nextSourceId}`));
    content.id = `document-minimap-source-${nextSourceId}`;
  }
  const controlledId = content.id;
  element.setAttribute('aria-controls', content.id);

  function updateAria() {
    ariaFrame = 0;
    if (disposed) return;
    const position = Math.min(maxScroll, Math.max(0, viewport.scrollTop));
    element.setAttribute('aria-valuemax', String(Math.round(maxScroll)));
    element.setAttribute('aria-valuenow', String(Math.round(position)));
    element.setAttribute(
      'aria-valuetext',
      `${maxScroll ? Math.round((position / maxScroll) * 100) : 0}%`
    );
    element.setAttribute('aria-disabled', String(maxScroll === 0));
  }

  function onScroll() {
    if (!ariaFrame) ariaFrame = window.requestAnimationFrame(updateAria);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const viewHeight = pageScroll ? window.innerHeight : viewport.clientHeight;
    const positions: Record<string, number> = {
      ArrowUp: viewport.scrollTop - 40,
      ArrowDown: viewport.scrollTop + 40,
      PageUp: viewport.scrollTop - viewHeight * 0.9,
      PageDown: viewport.scrollTop + viewHeight * 0.9,
      Home: 0,
      End: viewport.scrollHeight - viewHeight,
    };
    const position = positions[event.key];
    if (position === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    viewport.scrollTop = position;
  }

  function snapshot() {
    children = Array.from(content.childNodes);
    indices = new Map(children.map((node, index) => [node, index]));
  }

  function collectRemovedPlaceholders() {
    for (const element of complexSizes.keys()) {
      if (!content.contains(element)) {
        resizeObserver.unobserve(element);
        complexSizes.delete(element);
      }
    }
  }

  function flush() {
    frame = 0;
    if (disposed || !content.isConnected || !host.isConnected) return;
    const nextWidth = content.getBoundingClientRect().width;
    if (!nextWidth || !host.clientWidth || !host.clientHeight) return;
    if (!initialized || rebuild) {
      if (!initialized) minimap.setEnabled(true);
      else minimap.refresh();
      initialized = true;
      rebuild = false;
      snapshot();
    } else {
      // Text reflows at the new width without cloning; only measured placeholders need patching.
      if (nextWidth !== width) {
        minimap.resize();
        markComplexBlocks();
      }
      const inserted = new Set<Node>();
      if (structural) {
        const next = Array.from(content.childNodes);
        let start = 0;
        while (start < children.length && start < next.length && children[start] === next[start])
          start++;
        let end = children.length;
        let nextEnd = next.length;
        while (end > start && nextEnd > start && children[end - 1] === next[nextEnd - 1]) {
          end--;
          nextEnd--;
        }
        if (end !== start || nextEnd !== start) {
          for (let index = start; index < nextEnd; index++) inserted.add(next[index]!);
          if (minimap.spliceChildren(start, end - start, nextEnd - start)) patches++;
          else dirty.clear(); // The library already rebuilt after an invariant mismatch.
        }
        snapshot();
      }
      const changed = Array.from(dirty)
        .filter((node) => indices.has(node) && !inserted.has(node))
        .map((node) => indices.get(node)!)
        .sort((a, b) => a - b);
      for (let index = 0; index < changed.length;) {
        const start = changed[index]!;
        let count = 1;
        while (changed[index + count] === start + count) count++;
        if (minimap.spliceChildren(start, count, count)) patches++;
        else break;
        index += count;
      }
    }
    if (structural || prunePlaceholders) collectRemovedPlaceholders();
    prunePlaceholders = false;
    width = nextWidth;
    dirty.clear();
    structural = false;
    minimap.resize();
    maxScroll = Math.max(
      0,
      viewport.scrollHeight - (pageScroll ? window.innerHeight : viewport.clientHeight)
    );
    updateAria();
    if (import.meta.env.DEV) {
      element.dataset.minimapBuilds = String(builds);
      element.dataset.minimapPatches = String(patches);
      element.dataset.minimapBlocks = String(children.length);
    }
  }

  function queueFrame() {
    idle = 0;
    if (!disposed && !frame) frame = window.requestAnimationFrame(flush);
  }

  function queueIdle() {
    timer = 0;
    if (disposed) return;
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(queueFrame, { timeout: 400 });
    } else queueFrame();
  }

  function schedule() {
    // One trailing batch per burst, with a bounded idle timeout; scroll never enters this path.
    if (disposed || timer || idle || frame) return;
    timer = window.setTimeout(queueIdle, initialized ? 180 : 0);
  }

  const mutations = new MutationObserver((records) => {
    let changed = false;
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target || (target !== content && cloner.ignored(target))) continue;
      if (
        record.type === 'attributes' &&
        record.oldValue === target.getAttribute(record.attributeName!)
      )
        continue;
      const complex = cloner.placeholderRoot(target);
      if (complex) {
        // Internal code/table UI changes never affect a placeholder. Alignment may change margins without resizing.
        if (
          record.type === 'attributes' &&
          target === complex &&
          ['style', 'data-align', 'hidden'].includes(record.attributeName ?? '')
        ) {
          const block = topLevel(complex);
          if (block) dirty.add(block);
          changed = true;
        }
        continue;
      }
      if (record.type === 'attributes') {
        if (target === content) continue; // Focus and selection attributes are editor UI only.
        if (
          record.attributeName === 'class' &&
          stableClassName(record.oldValue) === stableClassName(target.getAttribute('class'))
        )
          continue;
      }
      if (record.type === 'childList' && record.removedNodes.length) prunePlaceholders = true;
      if (record.type === 'childList' && record.target === content) structural = true;
      else {
        const block = topLevel(record.target);
        if (block) dirty.add(block);
      }
      changed = true;
    }
    if (changed) schedule();
  });
  mutations.observe(content, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: [
      'class',
      'style',
      'width',
      'height',
      'src',
      'data-align',
      'hidden',
      'checked',
      'open',
    ],
  });
  resizeObserver.observe(content);
  if (!pageScroll) resizeObserver.observe(viewport);

  const themeObserver = new MutationObserver(() => {
    const clone = element.querySelector<HTMLElement>('[data-minimap-clone]');
    if (clone) copyTypography(clone);
    markComplexBlocks();
    schedule();
  });
  for (const target of [document.documentElement, document.body]) {
    themeObserver.observe(target, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style'],
    });
  }
  function resize() {
    schedule();
  }
  function refresh() {
    rebuild = true;
    schedule();
  }

  element.addEventListener('keydown', onKeydown);
  scrollTarget.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  schedule();

  return {
    element,
    resize,
    refresh,
    destroy() {
      if (disposed) return;
      disposed = true;
      window.clearTimeout(timer);
      if (idle) window.cancelIdleCallback(idle);
      if (frame) window.cancelAnimationFrame(frame);
      if (ariaFrame) window.cancelAnimationFrame(ariaFrame);
      mutations.disconnect();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      element.removeEventListener('keydown', onKeydown);
      scrollTarget.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', resize);
      minimap.destroy();
      if (assignedId && content.id === controlledId) content.removeAttribute('id');
      dirty.clear();
      complexSizes.clear();
      children = [];
      indices.clear();
    },
  };
}
