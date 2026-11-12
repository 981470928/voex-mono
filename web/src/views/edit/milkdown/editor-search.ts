import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export const SEARCH_MATCH_CLASS = 'milkdown-editor__search-match';
export const SEARCH_CURRENT_CLASS = 'milkdown-editor__search-match--current';

export interface SearchOptions {
  caseSensitive: boolean;
  regex: boolean;
}

export interface SearchMatch {
  from: number;
  to: number;
  text: string;
  // [完整匹配, $1, $2, …]，供替换时展开分组引用。
  groups: (string | undefined)[];
}

export interface SearchStatus {
  query: string;
  options: SearchOptions;
  matches: SearchMatch[];
  currentIndex: number;
  error: string | null;
}

export interface DocumentSearchController {
  status: () => SearchStatus;
  subscribe: (listener: () => void) => () => void;
  setQuery: (query: string) => void;
  setOptions: (options: Partial<SearchOptions>) => void;
  next: () => void;
  prev: () => void;
  replaceCurrent: (replacement: string) => boolean;
  replaceAll: (replacement: string) => number;
  clear: () => void;
}

export interface EditorSearch {
  plugins: MilkdownPlugin[];
  controller: DocumentSearchController;
  destroy: () => void;
}

interface EditorSearchOptions {
  readonly: () => boolean;
  view: () => EditorView | null;
}

// ProseMirror 文本位置使用 UTF-16；emoji 等原子节点无论字符长度只占一个位置。
// 非文本组件（图片、附件）处断开匹配，避免命中跨越组件边界。
export function findMatches(
  doc: ProseMirrorNode,
  query: string,
  options: SearchOptions
): SearchMatch[] {
  if (!query) return [];
  // 字面搜索也走正则：i 标志做大小写折叠，避免 toLowerCase 改变字符串长度。
  const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(source, options.caseSensitive ? 'g' : 'gi');
  const matches: SearchMatch[] = [];
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  doc.descendants((block, position) => {
    if (!block.isTextblock) return;
    let text = '';
    let boundaries: (number | null)[] = [];
    const flush = () => {
      // 一个可见字符可能横跨多个文本节点；不允许匹配切开它。
      for (const { index, segment } of graphemes.segment(text))
        for (let offset = index + 1; offset < index + segment.length; offset++)
          boundaries[offset] = null;
      pattern.lastIndex = 0;
      let result: RegExpExecArray | null;
      while ((result = pattern.exec(text))) {
        if (!result[0]) {
          pattern.lastIndex++;
          continue;
        }
        const from = boundaries[result.index];
        const to = boundaries[result.index + result[0].length];
        if (from != null && to != null)
          matches.push({ from, to, text: result[0], groups: [...result] });
      }
      text = '';
      boundaries = [];
    };
    block.forEach((node, offset) => {
      const start = position + 1 + offset;
      const value = node.isText
        ? node.text!
        : node.type.name === 'voex_emoji'
          ? String(node.attrs.char ?? '')
          : node.type.name === 'hardbreak'
            ? node.attrs.isInline
              ? ' '
              : '\n'
            : null;
      if (value === null || !value) {
        flush();
        return;
      }
      const length = text.length;
      text += value;
      boundaries[length] = start;
      for (let index = 1; index < value.length; index++)
        boundaries[length + index] = node.isText ? start + index : null;
      boundaries[text.length] = start + node.nodeSize;
    });
    flush();
    return false;
  });
  matches.sort((a, b) => a.from - b.from);
  return matches;
}

// 正则模式下展开 $1…$9、$&、$$；字面模式原样返回。
export function expandReplacement(template: string, match: SearchMatch, regex: boolean): string {
  if (!regex) return template;
  return template.replace(/\$(\$|&|\d{1,2})/g, (whole, ref: string) => {
    if (ref === '$') return '$';
    if (ref === '&') return match.text;
    const group = match.groups[Number(ref)];
    return group === undefined && Number(ref) >= match.groups.length ? whole : (group ?? '');
  });
}

const INVALID_REGEX_MESSAGE = '正则表达式无效，请检查语法';

const SCROLL_MARGIN = 24;

// block: nearest 语义把文档区间滚入可视区：只在越界时滚动，逐层处理滚动容器。
function scrollRangeIntoView(view: EditorView, from: number, to: number) {
  let top: number;
  let bottom: number;
  try {
    const start = view.domAtPos(from);
    const end = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const rect = range.getBoundingClientRect();
    top = rect.top;
    bottom = rect.bottom;
    if (!rect.height && !rect.width) {
      const coords = view.coordsAtPos(from);
      top = coords.top;
      bottom = coords.bottom;
    }
  } catch {
    return;
  }
  for (let element = view.dom.parentElement; element; element = element.parentElement) {
    if (element.scrollHeight <= element.clientHeight) continue;
    const overflowY = getComputedStyle(element).overflowY;
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    const box = element.getBoundingClientRect();
    if (top < box.top + SCROLL_MARGIN) element.scrollTop -= box.top + SCROLL_MARGIN - top;
    else if (bottom > box.bottom - SCROLL_MARGIN)
      element.scrollTop += bottom - box.bottom + SCROLL_MARGIN;
  }
  const viewport = window.innerHeight;
  if (top < SCROLL_MARGIN) window.scrollBy(0, top - SCROLL_MARGIN);
  else if (bottom > viewport - SCROLL_MARGIN) window.scrollBy(0, bottom - viewport + SCROLL_MARGIN);
}

export function createEditorSearch(options: EditorSearchOptions): EditorSearch {
  const searchKey = new PluginKey('voex-editor-search');
  let query = '';
  let searchOptions: SearchOptions = { caseSensitive: false, regex: false };
  let matches: SearchMatch[] = [];
  let currentIndex = -1;
  let error: string | null = null;
  let version = 0;
  // 替换后把游标停在插入文本之后，避免命中刚替换出的文本。
  let pendingAnchor: number | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  const notify = () => {
    if (disposed) return;
    // 高亮插件会在视图更新中触发重算，通知推迟到微任务避免重入。
    queueMicrotask(() => {
      if (!disposed) listeners.forEach((listener) => listener());
    });
  };

  const snapshot = (): SearchStatus => ({
    query,
    options: { ...searchOptions },
    matches: [...matches],
    currentIndex,
    error,
  });

  const currentAnchor = () =>
    pendingAnchor ?? (currentIndex >= 0 ? matches[currentIndex]?.from : undefined);

  const recompute = (doc: ProseMirrorNode) => {
    const anchor = currentAnchor();
    pendingAnchor = null;
    try {
      matches = findMatches(doc, query, searchOptions);
      error = null;
    } catch {
      matches = [];
      error = INVALID_REGEX_MESSAGE;
    }
    if (!matches.length) currentIndex = -1;
    else if (anchor === undefined) currentIndex = 0;
    else {
      const next = matches.findIndex((match) => match.from >= anchor);
      currentIndex = next < 0 ? 0 : next;
    }
    version++;
    notify();
  };

  // 高亮只走本地装饰；这里派发的是 meta-only 事务，不进协同与历史。
  const refreshView = () => {
    const view = options.view();
    if (!view || view.isDestroyed) return;
    view.dispatch(view.state.tr.setMeta(searchKey, { tick: 1 }));
  };

  const update = (doc: ProseMirrorNode | null) => {
    if (doc) recompute(doc);
    refreshView();
  };

  const goTo = (index: number) => {
    if (!matches.length) return;
    const length = matches.length;
    currentIndex = ((index % length) + length) % length;
    pendingAnchor = null;
    version++;
    notify();
    const view = options.view();
    if (!view || view.isDestroyed) return;
    const match = matches[currentIndex];
    if (!match) return;
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, match.from, match.to))
        .scrollIntoView()
    );
    // 焦点留在搜索框时 DOM 选区不在正文内，ProseMirror 的 scrollToSelection 会直接跳过，手动滚入。
    scrollRangeIntoView(view, match.from, match.to);
  };

  const controller: DocumentSearchController = {
    status: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setQuery(next) {
      if (next === query) return;
      query = next;
      update(options.view()?.state.doc ?? null);
    },
    setOptions(next) {
      if (next.caseSensitive === undefined && next.regex === undefined) return;
      searchOptions = {
        caseSensitive: next.caseSensitive ?? searchOptions.caseSensitive,
        regex: next.regex ?? searchOptions.regex,
      };
      update(options.view()?.state.doc ?? null);
    },
    next() {
      goTo(currentIndex + 1);
    },
    prev() {
      goTo(currentIndex <= 0 ? matches.length - 1 : currentIndex - 1);
    },
    replaceCurrent(replacement) {
      if (options.readonly() || currentIndex < 0) return false;
      const view = options.view();
      if (!view || view.isDestroyed) return false;
      const match = matches[currentIndex];
      if (!match) return false;
      const text = expandReplacement(replacement, match, searchOptions.regex);
      if (text === match.text) {
        goTo(currentIndex + 1);
        return true;
      }
      const tr = view.state.tr;
      // 继承命中起点的格式，不能使用搜索框获焦前光标处的 storedMarks。
      const marks = view.state.doc.nodeAt(match.from)?.marks;
      if (text) tr.replaceWith(match.from, match.to, view.state.schema.text(text, marks));
      else tr.delete(match.from, match.to);
      // 从头重算后停在插入文本之后的第一处命中。
      pendingAnchor = match.from + text.length;
      view.dispatch(tr);
      // 替换后跳到下一处命中并滚入可视区。
      goTo(currentIndex);
      return true;
    },
    replaceAll(replacement) {
      if (options.readonly() || !matches.length) return 0;
      const view = options.view();
      if (!view || view.isDestroyed) return 0;
      const { schema } = view.state;
      const tr = view.state.tr;
      // 倒序套用，单个事务一步撤销；前面位置不随后面替换位移。
      for (let index = matches.length - 1; index >= 0; index--) {
        const match = matches[index];
        if (!match) continue;
        const text = expandReplacement(replacement, match, searchOptions.regex);
        // 相同文字不重建节点，保留跨格式命中中的原有 marks 和内联组件。
        if (text === match.text) continue;
        const marks = view.state.doc.nodeAt(match.from)?.marks;
        if (text) tr.replaceWith(match.from, match.to, schema.text(text, marks));
        else tr.delete(match.from, match.to);
      }
      const count = matches.length;
      pendingAnchor = 0;
      view.dispatch(tr);
      return count;
    },
    clear() {
      query = '';
      matches = [];
      currentIndex = -1;
      error = null;
      pendingAnchor = null;
      version++;
      notify();
      refreshView();
    },
  };

  // 高亮纯本地装饰，不派发文档事务；Yjs 协同下额外事务会吞掉用户编辑（见 editor-content.ts）。
  const highlight = $prose(() => {
    let previousDoc: ProseMirrorNode | null = null;
    let previousVersion = -1;
    let decorations = DecorationSet.empty;
    return new Plugin({
      props: {
        decorations(state) {
          if (state.doc !== previousDoc) recompute(state.doc);
          if (state.doc === previousDoc && version === previousVersion) return decorations;
          previousDoc = state.doc;
          previousVersion = version;
          decorations = DecorationSet.create(
            state.doc,
            matches.map((match, index) =>
              Decoration.inline(match.from, match.to, {
                class: index === currentIndex ? SEARCH_CURRENT_CLASS : SEARCH_MATCH_CLASS,
              })
            )
          );
          return decorations;
        },
      },
    });
  });

  return {
    plugins: [highlight],
    controller,
    destroy() {
      disposed = true;
      listeners.clear();
    },
  };
}
