import { commandsCtx, editorViewCtx, editorViewOptionsCtx, type CmdKey } from '@milkdown/kit/core';
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import { block, blockConfig, BlockProvider } from '@milkdown/kit/plugin/block';
import { slashFactory, SlashProvider } from '@milkdown/kit/plugin/slash';
import { tooltipFactory, TooltipProvider } from '@milkdown/kit/plugin/tooltip';
import {
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { Fragment } from '@milkdown/kit/prose/model';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

import { CARD_LIST, CARD_ITEM, CARD_TEXT, type CardLayout } from './card-list-model';

export interface EditorAction {
  id: string;
  label: string;
  text: string;
  run: (ctx: Ctx) => void;
  active?: (ctx: Ctx) => boolean;
  enabled?: (ctx: Ctx) => boolean;
  opensDialog?: boolean;
}

interface EditorInteractionOptions {
  readonly: () => boolean;
  allowAttachments?: () => boolean;
  onAttachment: () => void;
  onLink: () => void;
  onPexels: () => void;
  onCardList: (layout: CardLayout) => void;
  onColorToolbar?: (element: HTMLElement | null) => void;
  isColorMenuOpen?: () => boolean;
}

interface SlashAction extends EditorAction {
  keywords: string;
  hint: string;
}

interface SlashRange {
  from: number;
  to: number;
  query: string;
}

let interactionId = 0;

function commandAction<T>(
  id: string,
  label: string,
  text: string,
  key: () => CmdKey<T>,
  payload?: T
): EditorAction {
  return {
    id,
    label,
    text,
    run: (ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!view.editable || view.isDestroyed) return;
      ctx.get(commandsCtx).call(key(), payload);
      view.focus();
    },
    enabled: (ctx) => {
      const view = ctx.get(editorViewCtx);
      return (
        view.editable &&
        !view.isDestroyed &&
        ctx.get(commandsCtx).get(key())(payload)(view.state, undefined, view)
      );
    },
  };
}

function markActive(ctx: Ctx, name: string) {
  const { state } = ctx.get(editorViewCtx);
  const type = state.schema.marks[name];
  if (!type) return false;
  const { from, to, empty, $from } = state.selection;
  return empty
    ? Boolean(type.isInSet(state.storedMarks ?? $from.marks()))
    : state.doc.rangeHasMark(from, to, type);
}

export function createFormattingActions(onLink: () => void): EditorAction[] {
  return [
    {
      ...commandAction('strong', '加粗', 'B', () => toggleStrongCommand.key),
      active: (ctx) => markActive(ctx, 'strong'),
    },
    {
      ...commandAction('emphasis', '斜体', 'I', () => toggleEmphasisCommand.key),
      active: (ctx) => markActive(ctx, 'emphasis'),
    },
    {
      ...commandAction('strike_through', '删除线', 'S', () => toggleStrikethroughCommand.key),
      active: (ctx) => markActive(ctx, 'strike_through'),
    },
    {
      ...commandAction('inlineCode', '行内代码', '</>', () => toggleInlineCodeCommand.key),
      active: (ctx) => markActive(ctx, 'inlineCode'),
    },
    {
      id: 'link',
      opensDialog: true,
      label: '链接',
      text: '链接',
      active: (ctx) => markActive(ctx, 'link'),
      enabled: (ctx) => {
        const view = ctx.get(editorViewCtx);
        const link = view.state.schema.marks.link;
        return (
          view.editable &&
          !view.isDestroyed &&
          Boolean(link && view.state.selection.$from.parent.type.allowsMarkType(link))
        );
      },
      run: (ctx) => {
        const view = ctx.get(editorViewCtx);
        if (view.editable && !view.isDestroyed) onLink();
      },
    },
  ];
}

function createSlashActions(
  onAttachment: () => void,
  onPexels: () => void,
  onCardList: (layout: CardLayout) => void
): SlashAction[] {
  const action = (item: EditorAction, keywords: string, hint: string): SlashAction => ({
    ...item,
    keywords: `${item.label} ${keywords}`.toLowerCase(),
    hint,
  });

  return [
    action(
      {
        ...commandAction('paragraph', '正文', 'T', () => turnIntoTextCommand.key),
        enabled: (ctx) => ctx.get(editorViewCtx).editable,
      },
      '普通段落 text paragraph p zw',
      '普通段落'
    ),
    ...[1, 2, 3].map((level) =>
      action(
        commandAction(
          `heading-${level}`,
          `${level} 级标题`,
          `H${level}`,
          () => wrapInHeadingCommand.key,
          level
        ),
        `heading title h${level} bt ${['一', '二', '三'][level - 1]}级标题`,
        `${'#'.repeat(level)} 空格`
      )
    ),
    action(
      commandAction('bullet', '无序列表', '•', () => wrapInBulletListCommand.key),
      'bullet unordered list wulb',
      '- 空格'
    ),
    action(
      commandAction('ordered', '有序列表', '1.', () => wrapInOrderedListCommand.key),
      'ordered numbered list yxlb',
      '1. 空格'
    ),
    action(
      {
        ...commandAction('task', '任务列表', '☑', () => wrapInBulletListCommand.key),
        run: (ctx) => {
          const view = ctx.get(editorViewCtx);
          if (!view.editable || view.isDestroyed) return;
          ctx.get(commandsCtx).call(wrapInBulletListCommand.key);
          const { $from } = view.state.selection;
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            const node = $from.node(depth);
            if (node.type.name !== 'list_item') continue;
            view.dispatch(
              view.state.tr.setNodeMarkup($from.before(depth), undefined, {
                ...node.attrs,
                checked: false,
              })
            );
            break;
          }
          view.focus();
        },
      },
      'task todo checklist rwlb',
      '待办事项'
    ),
    action(
      commandAction('blockquote', '引用', '“', () => wrapInBlockquoteCommand.key),
      'quote blockquote yy',
      '> 空格'
    ),
    action(
      commandAction('code', '代码块', '{}', () => createCodeBlockCommand.key),
      'code codeblock dmk',
      '``` 空格'
    ),
    action(
      commandAction('table', '表格', '▦', () => insertTableCommand.key, { row: 3, col: 3 }),
      'table grid bg',
      '3 × 3 表格'
    ),
    ...(['horizontal', 'vertical'] as const).map((layout) =>
      action(
        {
          id: `cards-${layout}`,
          label: layout === 'horizontal' ? '横向卡片列表' : '纵向卡片列表',
          text: layout === 'horizontal' ? '▤' : '▥',
          run: () => onCardList(layout),
        },
        `card cards layout 卡片 列表 kp ${layout}`,
        layout === 'horizontal' ? '每行最多 4 项，自动换行' : '左图右文，逐项排列'
      )
    ),
    action(
      commandAction('divider', '分割线', '—', () => insertHrCommand.key),
      'divider horizontal rule hr fgx',
      '分隔内容'
    ),
    action(
      {
        id: 'attachment',
        label: '附件',
        text: '+',
        run: (ctx) => {
          const view = ctx.get(editorViewCtx);
          if (view.editable && !view.isDestroyed) onAttachment();
        },
      },
      'attachment file upload fj',
      '选择文件'
    ),
    action(
      {
        id: 'pexels',
        label: 'Pexels 图库',
        text: '图',
        run: (ctx) => {
          const view = ctx.get(editorViewCtx);
          if (view.editable && !view.isDestroyed) onPexels();
        },
      },
      'image photo picture gallery pexels 图片 图库 tk',
      '搜索并插入图片'
    ),
  ];
}

function createPopover(view: EditorView, className: string, label: string) {
  const element = view.dom.ownerDocument.createElement('div');
  element.className = `milkdown-editor__popover ${className}`;
  element.setAttribute('aria-label', label);
  element.style.position = 'absolute';
  element.dataset.show = 'false';
  element.hidden = true;
  return element;
}

function createButton(document: Document, className: string, label: string, text: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.textContent = text;
  return button;
}

function slashRange(view: EditorView): SlashRange | null {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  if ($from.parent.type.name !== 'paragraph') return null;
  const text = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC');
  const match = /(?:^|\s)\/([^\s/]*)$/u.exec(text);
  if (!match) return null;
  const query = match[1] ?? '';
  return { from: $from.pos - query.length - 1, to: $from.pos, query };
}

function rangeKey(range: SlashRange | null) {
  return range ? `${range.from}:${range.query}` : '';
}

export function createEditorInteractions(options: EditorInteractionOptions): {
  plugins: MilkdownPlugin[];
  configure: (ctx: Ctx) => void;
  hide: () => void;
  refresh: () => void;
} {
  const id = ++interactionId;
  const tooltip = tooltipFactory(`voex-format-${id}`);
  const slash = slashFactory(`voex-slash-${id}`);
  const hideCallbacks = new Set<() => void>();
  let refreshTooltip: (() => void) | undefined;
  const canEdit = (view: EditorView) => !options.readonly() && view.editable && !view.isDestroyed;

  const watchDismissal = (
    view: EditorView,
    element: HTMLElement,
    hide: () => void,
    onScroll?: () => void
  ) => {
    const controller = new AbortController();
    const { signal } = controller;
    const document = view.dom.ownerDocument;
    document.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target;
        if (target instanceof Node && !element.contains(target) && !view.dom.contains(target))
          hide();
      },
      { capture: true, signal }
    );
    document.addEventListener(
      'focusin',
      (event) => {
        const target = event.target;
        if (target instanceof Node && !element.contains(target) && !view.dom.contains(target))
          hide();
      },
      { signal }
    );
    document.addEventListener(
      'scroll',
      (event) => {
        if (event.target instanceof Node && element.contains(event.target)) return;
        if (onScroll) onScroll();
        else hide();
      },
      { capture: true, passive: true, signal }
    );
    document.defaultView?.addEventListener('blur', hide, { signal });
    hideCallbacks.add(hide);
    return () => {
      controller.abort();
      hideCallbacks.delete(hide);
    };
  };

  return {
    plugins: [...block, ...tooltip, ...slash],
    hide: () => hideCallbacks.forEach((hide) => hide()),
    refresh: () => refreshTooltip?.(),
    configure: (ctx) => {
      ctx.update(blockConfig.key, (config) => ({
        ...config,
        filterNodes: (pos, node) => {
          if (node.type.name === CARD_LIST) return true;
          if ([CARD_ITEM, CARD_TEXT].includes(node.type.name)) return false;
          return config.filterNodes(pos, node);
        },
      }));
      let focusTooltip: (() => boolean) | undefined;
      let handleSlashKey: ((event: KeyboardEvent) => boolean) | undefined;
      let revealInsertedSlash: (() => void) | undefined;
      let moveBlock: ((position: number, direction: number) => boolean) | undefined;
      // view 级键盘处理先于 preset keymap，避免 Enter 提前拆分段落。
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        handleKeyDown(view, event) {
          if (event.altKey && event.key === 'F10' && focusTooltip?.()) return true;
          if (
            event.altKey &&
            (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
            view.state.selection instanceof NodeSelection &&
            moveBlock?.(view.state.selection.from, event.key === 'ArrowUp' ? -1 : 1)
          )
            return true;
          if (handleSlashKey?.(event)) return true;
          return previous.handleKeyDown?.(view, event) ?? false;
        },
      }));
      ctx.set(tooltip.key, {
        view: (view) => {
          const element = createPopover(view, 'milkdown-editor__format', '选区格式');
          element.setAttribute('role', 'toolbar');
          const actions = createFormattingActions(options.onLink);
          const buttons = actions.map((action) => {
            const button = createButton(
              view.dom.ownerDocument,
              'milkdown-editor__action',
              action.label,
              action.text
            );
            if (action.id === 'link') {
              const document = view.dom.ownerDocument;
              const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              svg.setAttribute('width', '16');
              svg.setAttribute('height', '16');
              svg.setAttribute('viewBox', '0 0 16 16');
              svg.setAttribute('aria-hidden', 'true');
              svg.setAttribute('focusable', 'false');
              const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
              use.setAttribute('href', '#icon-editor-link');
              svg.append(use);
              button.replaceChildren(svg);
            }
            button.dataset.action = action.id;
            button.dataset.format = action.id;
            if (action.opensDialog) button.setAttribute('aria-haspopup', 'dialog');
            // 鼠标操作保留编辑器选区，键盘仍可正常聚焦按钮。
            button.addEventListener('mousedown', (event) => event.preventDefault());
            button.addEventListener('click', () => {
              if (!canEdit(view) || action.enabled?.(ctx) === false) return;
              action.run(ctx);
              refresh();
            });
            element.append(button);
            return button;
          });
          const colorToolbar = view.dom.ownerDocument.createElement('div');
          colorToolbar.className = 'milkdown-editor__color-controls';
          element.append(colorToolbar);
          options.onColorToolbar?.(colorToolbar);
          const enabledButtons = () => [
            ...element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          ];
          const refresh = () => {
            buttons.forEach((button, index) => {
              const action = actions[index]!;
              const active = action.active?.(ctx) ?? false;
              button.setAttribute('aria-pressed', String(active));
              button.classList.toggle('milkdown-editor__action--active', active);
              button.disabled = !canEdit(view) || action.enabled?.(ctx) === false;
            });
          };
          let dismissed = false;
          const provider = new TooltipProvider({
            content: element,
            root: view.dom.parentElement ?? undefined,
            debounce: 0,
            offset: 8,
            floatingUIOptions: { strategy: 'absolute' },
            shouldShow: () => {
              const { selection, doc } = view.state;
              return (
                canEdit(view) &&
                !dismissed &&
                selection instanceof TextSelection &&
                !selection.empty &&
                Boolean(doc.textBetween(selection.from, selection.to)) &&
                (options.isColorMenuOpen?.() ||
                  view.hasFocus() ||
                  element.contains(view.dom.ownerDocument.activeElement))
              );
            },
          });
          provider.onShow = () => {
            element.hidden = false;
            refresh();
          };
          provider.onHide = () => {
            element.hidden = true;
          };
          refreshTooltip = () => provider.update(view);
          const hide = () => {
            if (canEdit(view) && options.isColorMenuOpen?.()) return;
            dismissed = true;
            element.hidden = true;
            provider.hide();
          };
          const cleanup = watchDismissal(view, element, hide);
          element.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              hide();
              view.focus();
              return;
            }
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const enabled = enabledButtons();
            if (!enabled.length) return;
            const index = enabled.findIndex(
              (button) => button === view.dom.ownerDocument.activeElement
            );
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? enabled.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) %
                    enabled.length;
            event.preventDefault();
            enabled[next]?.focus();
          });
          focusTooltip = () => {
            if (!canEdit(view) || view.state.selection.empty) return false;
            dismissed = false;
            provider.update(view);
            const button = enabledButtons()[0];
            button?.focus();
            return Boolean(button);
          };
          return {
            update: (nextView, previousState) => {
              if (
                !previousState.selection.eq(nextView.state.selection) ||
                !previousState.doc.eq(nextView.state.doc)
              )
                dismissed = false;
              refresh();
              if (!canEdit(nextView)) hide();
              else provider.update(nextView, previousState);
            },
            destroy: () => {
              focusTooltip = undefined;
              refreshTooltip = undefined;
              options.onColorToolbar?.(null);
              cleanup();
              provider.destroy();
              element.remove();
            },
          };
        },
      });

      let compositionEnded: (() => void) | undefined;
      let compositionStarted: (() => void) | undefined;
      ctx.set(slash.key, {
        props: {
          handleDOMEvents: {
            compositionstart: () => {
              compositionStarted?.();
              return false;
            },
            compositionend: () => {
              compositionEnded?.();
              return false;
            },
          },
        },
        view: (view) => {
          const element = createPopover(view, 'milkdown-editor__slash', '插入内容');
          element.setAttribute('role', 'listbox');
          element.id = `milkdown-slash-${id}`;
          const actions = createSlashActions(
            options.onAttachment,
            options.onPexels,
            options.onCardList
          ).filter(
            (action) => action.id !== 'attachment' || options.allowAttachments?.() !== false
          );
          let filtered: SlashAction[] = [];
          let range: SlashRange | null = null;
          let dismissed = '';
          let selected = 0;
          let composing = false;
          let compositionUntil = 0;
          let compositionTimer: ReturnType<typeof setTimeout> | undefined;
          let insertScrollTimer: ReturnType<typeof setTimeout> | undefined;
          let insertScrollKey = '';
          const scrollEvents = new AbortController();
          let destroyed = false;
          const stopInsertScroll = () => {
            clearTimeout(insertScrollTimer);
            insertScrollTimer = undefined;
            insertScrollKey = '';
          };
          const priorControls = view.dom.getAttribute('aria-controls');
          const priorActive = view.dom.getAttribute('aria-activedescendant');
          const resetAria = () => {
            if (priorControls === null) view.dom.removeAttribute('aria-controls');
            else view.dom.setAttribute('aria-controls', priorControls);
            if (priorActive === null) view.dom.removeAttribute('aria-activedescendant');
            else view.dom.setAttribute('aria-activedescendant', priorActive);
          };
          const syncSelected = (scroll = false) => {
            const buttons = element.querySelectorAll<HTMLButtonElement>(
              '.milkdown-editor__slash-item'
            );
            buttons.forEach((button, index) =>
              button.setAttribute('aria-selected', String(index === selected))
            );
            const button = buttons[selected];
            if (button) {
              view.dom.setAttribute('aria-controls', element.id);
              view.dom.setAttribute('aria-activedescendant', button.id);
              if (scroll) button.scrollIntoView({ block: 'nearest' });
            } else resetAria();
          };
          const execute = (action: SlashAction) => {
            const current = slashRange(view);
            if (
              !canEdit(view) ||
              composing ||
              Date.now() < compositionUntil ||
              !current ||
              rangeKey(current) !== rangeKey(range)
            )
              return;
            if (action.enabled?.(ctx) === false) return;
            // 只删除本次触发的 / 查询，保留段落前后已有内容。
            const tr = view.state.tr.delete(current.from, current.to);
            tr.setSelection(TextSelection.create(tr.doc, current.from));
            hide();
            view.dispatch(tr);
            action.run(ctx);
          };
          const render = () => {
            element.replaceChildren();
            if (!filtered.length) {
              const empty = view.dom.ownerDocument.createElement('div');
              empty.className = 'milkdown-editor__empty';
              empty.setAttribute('role', 'status');
              empty.textContent = '没有匹配的内容';
              element.append(empty);
            }
            filtered.forEach((action, index) => {
              const button = createButton(
                view.dom.ownerDocument,
                'milkdown-editor__slash-item',
                action.label,
                ''
              );
              button.id = `${element.id}-${action.id}`;
              button.tabIndex = -1;
              button.setAttribute('role', 'option');
              button.disabled = action.enabled?.(ctx) === false;
              const icon = view.dom.ownerDocument.createElement('span');
              icon.className = 'milkdown-editor__slash-icon';
              icon.textContent = action.text;
              icon.setAttribute('aria-hidden', 'true');
              const label = view.dom.ownerDocument.createElement('span');
              label.className = 'milkdown-editor__slash-label';
              label.textContent = action.label;
              const hint = view.dom.ownerDocument.createElement('span');
              hint.className = 'milkdown-editor__slash-hint';
              hint.textContent = action.hint;
              button.append(icon, label, hint);
              button.addEventListener('mousedown', (event) => event.preventDefault());
              button.addEventListener('pointermove', () => {
                selected = index;
                syncSelected();
              });
              button.addEventListener('click', () => execute(action));
              element.append(button);
            });
            syncSelected();
          };
          const provider = new SlashProvider({
            content: element,
            root: view.dom.parentElement ?? undefined,
            debounce: 0,
            offset: 8,
            floatingUIOptions: { strategy: 'absolute' },
            shouldShow: () => {
              const current = slashRange(view);
              if (
                destroyed ||
                !canEdit(view) ||
                composing ||
                Date.now() < compositionUntil ||
                !view.hasFocus() ||
                !current ||
                rangeKey(current) === dismissed
              )
                return false;
              if (rangeKey(current) !== rangeKey(range)) selected = 0;
              range = current;
              filtered = actions.filter((action) =>
                action.keywords.includes(current.query.toLowerCase())
              );
              selected = Math.min(selected, Math.max(filtered.length - 1, 0));
              render();
              return true;
            },
          });
          provider.onShow = () => {
            element.hidden = false;
            syncSelected();
          };
          provider.onHide = () => {
            element.hidden = true;
            resetAria();
          };
          const hide = () => {
            stopInsertScroll();
            dismissed = rangeKey(slashRange(view));
            element.hidden = true;
            provider.hide();
          };
          const finishInsertScroll = () => {
            clearTimeout(insertScrollTimer);
            insertScrollTimer = setTimeout(() => {
              stopInsertScroll();
              if (!destroyed) provider.update(view);
            }, 150);
          };
          const cleanup = watchDismissal(view, element, hide, () => {
            if (insertScrollKey && rangeKey(slashRange(view)) === insertScrollKey) {
              // 加号触发的自动滚动只更新菜单定位，不作为用户关闭菜单。
              provider.update(view);
              finishInsertScroll();
            } else hide();
          });
          const interruptInsertScroll = (event: Event) => {
            if (insertScrollKey && event.target instanceof Node && !element.contains(event.target))
              hide();
          };
          for (const type of ['wheel', 'touchstart'])
            view.dom.ownerDocument.addEventListener(type, interruptInsertScroll, {
              capture: true,
              passive: true,
              signal: scrollEvents.signal,
            });
          revealInsertedSlash = () => {
            stopInsertScroll();
            if (destroyed || !canEdit(view)) return;
            const current = slashRange(view);
            if (!current) return;
            dismissed = '';
            insertScrollKey = rangeKey(current);
            provider.update(view);
            const paragraph = view.nodeDOM(view.state.selection.$from.before());
            if (paragraph instanceof Element)
              paragraph.scrollIntoView({
                block: 'nearest',
                inline: 'nearest',
                behavior: view.dom.ownerDocument.defaultView?.matchMedia(
                  '(prefers-reduced-motion: reduce)'
                ).matches
                  ? 'instant'
                  : 'smooth',
              });
            finishInsertScroll();
          };
          compositionStarted = () => {
            stopInsertScroll();
            composing = true;
            element.hidden = true;
            provider.hide();
          };
          compositionEnded = () => {
            composing = false;
            // 中文候选确认的 Enter 不作为菜单确认键。
            compositionUntil = Date.now() + 50;
            clearTimeout(compositionTimer);
            compositionTimer = setTimeout(() => {
              if (!destroyed) provider.update(view);
            }, 50);
          };
          handleSlashKey = (event) => {
            if (
              !canEdit(view) ||
              composing ||
              view.composing ||
              event.isComposing ||
              event.keyCode === 229 ||
              Date.now() < compositionUntil ||
              element.hidden
            )
              return false;
            if (event.key === 'Escape') {
              hide();
              return true;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (filtered.length) {
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                for (let step = 0; step < filtered.length; step += 1) {
                  selected = (selected + direction + filtered.length) % filtered.length;
                  if (filtered[selected]?.enabled?.(ctx) !== false) break;
                }
                syncSelected(true);
              }
              return true;
            }
            if (event.key === 'Enter') {
              const action = filtered[selected];
              if (action) execute(action);
              return Boolean(action);
            }
            return false;
          };
          return {
            update: (nextView, previousState) => {
              const current = slashRange(nextView);
              if (!current) dismissed = '';
              if (insertScrollKey && rangeKey(current) !== insertScrollKey) stopInsertScroll();
              if (!canEdit(nextView)) hide();
              else provider.update(nextView, previousState);
            },
            destroy: () => {
              destroyed = true;
              clearTimeout(compositionTimer);
              stopInsertScroll();
              scrollEvents.abort();
              revealInsertedSlash = undefined;
              handleSlashKey = undefined;
              compositionStarted = undefined;
              compositionEnded = undefined;
              cleanup();
              resetAria();
              provider.destroy();
              element.remove();
            },
          };
        },
      });

      ctx.set(block.key, {
        view: (view) => {
          const element = createPopover(view, 'milkdown-editor__block', '块操作');
          element.setAttribute('role', 'group');
          const handle = createButton(
            view.dom.ownerDocument,
            'milkdown-editor__block-handle',
            '拖动或选择此块；Alt+↑/↓ 移动',
            '⠿'
          );
          handle.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
          const add = createButton(
            view.dom.ownerDocument,
            'milkdown-editor__block-add',
            '在下方插入内容',
            '+'
          );
          element.append(add, handle);
          let destroyed = false;
          let dismissed = false;
          const provider = new BlockProvider({
            ctx,
            content: element,
            root: view.dom.parentElement ?? undefined,
            getPlacement: () => 'left-start',
            getOffset: () => 6,
            floatingUIOptions: { strategy: 'absolute' },
          });
          const show = provider.show;
          provider.show = (active) => {
            if (destroyed || dismissed || !canEdit(view)) return;
            element.hidden = false;
            show(active);
          };
          const providerHide = provider.hide;
          provider.hide = () => {
            element.hidden = true;
            providerHide();
          };
          const hide = () => {
            dismissed = true;
            provider.hide();
          };
          const cleanup = watchDismissal(view, element, hide);
          const resume = () => {
            dismissed = false;
          };
          view.dom.addEventListener('pointermove', resume, { capture: true });
          element.addEventListener(
            'dragstart',
            (event) => {
              if (!canEdit(view) || event.target === add) {
                event.preventDefault();
                event.stopImmediatePropagation();
              }
            },
            { capture: true }
          );
          element.addEventListener(
            'mousedown',
            (event) => {
              if (!canEdit(view)) {
                event.preventDefault();
                event.stopImmediatePropagation();
              }
            },
            { capture: true }
          );
          handle.addEventListener('click', () => {
            const active = provider.active;
            if (!canEdit(view) || !active || !NodeSelection.isSelectable(active.node)) return;
            view.dispatch(
              view.state.tr.setSelection(NodeSelection.create(view.state.doc, active.$pos.pos))
            );
            view.focus();
          });
          moveBlock = (position, direction) => {
            if (!canEdit(view)) return false;
            const { doc, tr } = view.state;
            const $position = doc.resolve(position);
            const parent = $position.parent;
            const index = $position.index();
            const neighborIndex = index + direction;
            if (neighborIndex < 0 || neighborIndex >= parent.childCount) return false;
            const node = parent.child(index);
            const neighbor = parent.child(neighborIndex);
            const nodes = direction < 0 ? [node, neighbor] : [neighbor, node];
            const firstIndex = Math.min(index, neighborIndex);
            const fragment = Fragment.fromArray(nodes);
            if (!parent.canReplace(firstIndex, firstIndex + 2, fragment)) return false;
            const from = direction < 0 ? position - neighbor.nodeSize : position;
            const to = from + node.nodeSize + neighbor.nodeSize;
            const movedPosition = direction < 0 ? from : from + neighbor.nodeSize;
            tr.replaceWith(from, to, fragment);
            tr.setSelection(NodeSelection.create(tr.doc, movedPosition)).scrollIntoView();
            hide();
            view.dispatch(tr);
            view.focus();
            return true;
          };
          handle.addEventListener('keydown', (event) => {
            const active = provider.active;
            if (!active || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            moveBlock?.(active.$pos.pos, event.key === 'ArrowUp' ? -1 : 1);
          });
          add.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
          });
          add.addEventListener('click', () => {
            const active = provider.active;
            const paragraph = view.state.schema.nodes.paragraph;
            if (!canEdit(view) || !active || !paragraph) return;
            const parent = active.$pos.parent;
            const index = active.$pos.index() + 1;
            if (!parent.canReplaceWith(index, index, paragraph)) return;
            const position = active.$pos.pos + active.node.nodeSize;
            const tr = view.state.tr.insert(
              position,
              paragraph.create(null, view.state.schema.text('/'))
            );
            tr.setSelection(TextSelection.create(tr.doc, position + 2));
            hide();
            view.dispatch(tr);
            view.focus();
            revealInsertedSlash?.();
          });
          // BlockProvider 在下一帧初始化；销毁时还需清理已排队的初始化。
          provider.update();
          return {
            update: (nextView, previousState) => {
              if (!canEdit(nextView) || !previousState.doc.eq(nextView.state.doc)) hide();
            },
            destroy: () => {
              destroyed = true;
              moveBlock = undefined;
              cleanup();
              view.dom.removeEventListener('pointermove', resume, { capture: true });
              provider.hide();
              provider.destroy();
              requestAnimationFrame(() => provider.destroy());
            },
          };
        },
      });
    },
  };
}
