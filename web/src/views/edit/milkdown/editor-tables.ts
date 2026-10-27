import {
  tableBlock,
  tableBlockConfig,
  tableBlockView,
  TableNodeView,
  type RenderType,
} from '@milkdown/kit/component/table-block';
import { commandsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { moveColCommand, moveRowCommand, tableSchema } from '@milkdown/kit/preset/gfm';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { CellSelection, TableMap } from '@milkdown/kit/prose/tables';
import { columnResizingPluginKey, updateColumnsOnResize } from '@milkdown/kit/prose/tables';
import { $view } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';
import addIcon from '@/assets/svg/add.svg?raw';
import moreIcon from '@/assets/svg/more-16.svg?raw';
import trashIcon from '@/assets/svg/trash.svg?raw';
import alignLeftIcon from '@/assets/svg/editor-align-left.svg?raw';
import alignCenterIcon from '@/assets/svg/editor-align-center.svg?raw';
import alignRightIcon from '@/assets/svg/editor-align-right.svg?raw';
import {
  applyTableWidths,
  fitTableWidths,
  persistTableWidths,
  readTableWidths,
  resolveTableWidths,
  tableSignature,
  type TableColumnWidth,
} from './table-widths';
import './editor-tables.styl';

const labels: Record<RenderType, string> = {
  add_row: '插入行',
  add_col: '插入列',
  delete_row: '删除所选行',
  delete_col: '删除所选列',
  align_col_left: '左对齐',
  align_col_center: '居中对齐',
  align_col_right: '右对齐',
  col_drag_handle: '选择或拖动列，Alt + 左右方向键移动列',
  row_drag_handle: '选择或拖动行，Alt + 上下方向键移动行',
};

import { tableWidthsRemark, configureTables } from '@voex/editor-schema/tables';

function getTableIndex(view: EditorView, pos: number | undefined): number {
  if (pos === undefined) return -1;
  let index = 0;
  let result = -1;
  view.state.doc.descendants((node, nodePos) => {
    if (node.type.name !== 'table') return true;
    if (nodePos === pos) result = index;
    index++;
    return false;
  });
  return result;
}

export function createEditorTables(options: {
  readonly: () => boolean;
  documentKey: () => string;
  collaborative?: () => boolean;
}) {
  const refreshers = new Set<() => void>();
  const viewPlugin = $view(tableSchema.node, (ctx) => (node, view, getPos) => {
    class ResizableTableView extends TableNodeView {
      private readonly table: HTMLTableElement;
      private readonly colgroup: HTMLTableColElement;
      private readonly events = new AbortController();
      private readonly controls: HTMLDivElement;
      private hideTimer: ReturnType<typeof setTimeout> | undefined;
      private tableIndex = -1;
      private widths: TableColumnWidth[] | null = null;

      constructor() {
        super(ctx, node, view, getPos);
        this.table = this.contentDOM.parentElement as HTMLTableElement;
        this.colgroup = view.dom.ownerDocument.createElement('colgroup');
        this.table.prepend(this.colgroup);
        this.table.style.setProperty('--default-cell-min-width', '100px');
        this.tableIndex = getTableIndex(view, getPos());
        this.widths = options.collaborative?.()
          ? readTableWidths(node)
          : resolveTableWidths(node, options.documentKey(), this.tableIndex);
        this.syncColumns();
        this.persistWidths();
        // 控件独立于滚动容器，避免加号和手柄进入表格的 scrollWidth/scrollHeight。
        this.controls = view.dom.ownerDocument.createElement('div');
        this.controls.className = 'milkdown-editor__table-controls';
        this.controls.contentEditable = 'false';
        const handles = this.dom.querySelectorAll('.handle, .drag-preview');
        this.dom.firstElementChild!.appendChild(this.controls);
        this.controls.append(...handles);
        const { signal } = this.events;
        this.dom.addEventListener(
          'pointermove',
          (event) => {
            clearTimeout(this.hideTimer);
            const cell = event.target instanceof Element ? event.target.closest('td, th') : null;
            if (cell && this.table.contains(cell)) {
              this.closeMenus();
              const rect = cell.getBoundingClientRect();
              // 官方在距离边缘 8px 内切换成加号。保留最近格子的手柄，
              // 让鼠标能经过边界和 2px 间隙连续移到三点按钮。
              if (
                event.clientX > rect.left + 8 &&
                event.clientX < rect.right - 8 &&
                event.clientY > rect.top + 8 &&
                event.clientY < rect.bottom - 8
              ) {
                this.controls.querySelectorAll<HTMLElement>('.cell-handle').forEach((handle) => {
                  handle.dataset.hoverRetained = 'true';
                });
              }
            }
          },
          { capture: true, signal }
        );
        this.dom.addEventListener('pointerenter', () => clearTimeout(this.hideTimer), {
          capture: true,
          signal,
        });
        this.dom.addEventListener(
          'pointerleave',
          (event) => {
            // 阻止官方不可取消的 200ms 定时器；跨到手柄/菜单仍属于同一张表。
            event.stopPropagation();
            if (event.relatedTarget instanceof Node && this.dom.contains(event.relatedTarget))
              return;
            clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => {
              if (
                this.dom.matches(':hover') ||
                this.controls.contains(view.dom.ownerDocument.activeElement)
              )
                return;
              this.hideControls();
            }, 180);
          },
          { capture: true, signal }
        );
        view.dom.ownerDocument.addEventListener(
          'pointerdown',
          (event) => {
            if (event.target instanceof Node && !this.dom.contains(event.target))
              this.hideControls();
          },
          { capture: true, signal }
        );
        view.dom.ownerDocument.defaultView?.addEventListener('blur', this.hideControls, { signal });
        const addLabel = (selector: string, label: string) => {
          const element = this.dom.querySelector<HTMLElement>(selector);
          element?.setAttribute('aria-label', label);
          element?.setAttribute('title', label);
          return element;
        };
        for (const direction of ['col', 'row']) {
          const handle = addLabel(
            `[data-role="${direction}-drag-handle"]`,
            labels[`${direction}_drag_handle` as RenderType]
          );
          handle?.setAttribute('role', 'button');
          handle?.setAttribute('aria-haspopup', 'true');
        }
        addLabel('[data-role="x-line-drag-handle"] button', labels.add_row);
        addLabel('[data-role="y-line-drag-handle"] button', labels.add_col);
        const colButtons = this.dom.querySelectorAll<HTMLButtonElement>(
          '[data-role="col-drag-handle"] .button-group button'
        );
        (['align_col_left', 'align_col_center', 'align_col_right', 'delete_col'] as const).forEach(
          (action, index) => {
            colButtons[index]?.setAttribute('aria-label', labels[action]);
            colButtons[index]?.setAttribute('title', labels[action]);
          }
        );
        addLabel('[data-role="row-drag-handle"] .button-group button', labels.delete_row);
        this.dom.addEventListener(
          'click',
          (event) => {
            const button =
              event.target instanceof Element
                ? event.target.closest<HTMLButtonElement>('.button-group button')
                : null;
            if (!button) return;
            event.stopPropagation();
            this.closeMenus();
            // 官方操作绑定 pointerdown，补齐原生 button 的键盘激活。
            if (event.detail === 0 && !options.readonly() && view.editable)
              button.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
              );
          },
          { capture: true, signal }
        );
        this.dom.addEventListener(
          'keydown',
          (event) => {
            const target = event.target;
            if (
              !(target instanceof HTMLElement) ||
              !target.matches('.cell-handle') ||
              options.readonly() ||
              !view.editable
            )
              return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              target.click();
            }
            if (event.key === 'Escape') {
              this.closeMenus();
              target
                .querySelector<HTMLElement>('.button-group')
                ?.setAttribute('data-show', 'false');
              view.focus();
            }
            if (
              !event.altKey ||
              !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
            )
              return;
            const selection = view.state.selection;
            if (!(selection instanceof CellSelection)) return;
            const column = target.dataset.role === 'col-drag-handle';
            if (
              column
                ? !['ArrowLeft', 'ArrowRight'].includes(event.key)
                : !['ArrowUp', 'ArrowDown'].includes(event.key)
            )
              return;
            const $cell = selection.$anchorCell;
            const from = column ? $cell.index() : $cell.index(-1);
            const to = from + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
            const count = column ? this.node.firstChild!.childCount : this.node.childCount;
            if (to < (column ? 0 : 1) || to >= count || (!column && from === 0)) return;
            event.preventDefault();
            const command = column ? moveColCommand.key : moveRowCommand.key;
            ctx.get(commandsCtx).call(command, { from, to, pos: (getPos() ?? 0) + 1 });
          },
          { signal }
        );
        this.dom.addEventListener(
          'click',
          (event) => {
            const handle =
              event.target instanceof Element
                ? event.target.closest<HTMLElement>('.cell-handle')
                : null;
            if (!handle) return;
            const group = handle.querySelector<HTMLElement>('.button-group');
            const opening = handle.dataset.menuOpen !== 'true' && group?.dataset.show === 'true';
            this.closeMenus();
            if (!opening || !group) return;
            // 官方节流 pointermove 可能滞后关闭菜单；打开状态由本视图管理。
            handle.dataset.menuOpen = 'true';
            handle.setAttribute('aria-expanded', 'true');
            group.dataset.show = 'true';
            requestAnimationFrame(() => {
              if (!this.dom.isConnected || handle.dataset.menuOpen !== 'true') return;
              group.style.transform = '';
              group.style.top = '';
              group.style.bottom = '';
              const rect = group.getBoundingClientRect();
              if (rect.top < 8) {
                group.style.bottom = 'auto';
                group.style.top = '100%';
              }
              const width = view.dom.ownerDocument.documentElement.clientWidth;
              const layer = this.controls.getBoundingClientRect();
              const left = Math.max(8, layer.left + 2);
              const right = Math.min(width - 8, layer.right - 2);
              const shift = Math.max(left - rect.left, Math.min(0, right - rect.right));
              group.style.transform = `translateX(calc(-50% + ${shift}px))`;
            });
          },
          { signal }
        );
        const wrapper = this.dom.querySelector('.table-wrapper');
        wrapper?.addEventListener('scroll', this.hideControls, { passive: true, signal });
        refreshers.add(this.refresh);
        this.refresh();
      }

      private closeMenus = () => {
        this.dom
          .querySelectorAll<HTMLElement>('.cell-handle[data-menu-open="true"]')
          .forEach((handle) => {
            handle.dataset.menuOpen = 'false';
            handle.setAttribute('aria-expanded', 'false');
            handle.querySelector<HTMLElement>('.button-group')?.setAttribute('data-show', 'false');
          });
      };

      private hideControls = () => {
        clearTimeout(this.hideTimer);
        this.closeMenus();
        this.dom.querySelectorAll<HTMLElement>('.handle').forEach((handle) => {
          handle.dataset.show = 'false';
          delete handle.dataset.hoverRetained;
        });
      };

      refresh = () => {
        const readonly = options.readonly();
        this.dom.classList.toggle('readonly', readonly);
        if (readonly) this.hideControls();
        this.dom.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
          button.disabled = readonly;
        });
        this.dom.querySelectorAll<HTMLElement>('.cell-handle').forEach((handle) => {
          handle.tabIndex = readonly ? -1 : 0;
        });
      };

      private syncColumns() {
        const columnCount = TableMap.get(this.node).width;
        if (this.widths) {
          this.widths = fitTableWidths(this.widths, columnCount);
          if (this.widths) applyTableWidths(this.table, this.colgroup, this.widths, 100);
          else updateColumnsOnResize(this.node, this.colgroup, this.table, 100);
        } else updateColumnsOnResize(this.node, this.colgroup, this.table, 100);
      }

      private persistWidths() {
        if (options.readonly() || options.collaborative?.()) return;
        persistTableWidths(
          options.documentKey(),
          this.tableIndex,
          this.widths,
          tableSignature(this.node)
        );
      }

      update(nextNode: ProseNode) {
        if (nextNode.type !== this.node.type) return false;
        this.tableIndex = getTableIndex(view, getPos());
        // hover/选区 transaction 不重建视图，保留横向滚动和正在拖动的列宽预览。
        if (!nextNode.eq(this.node)) {
          this.hideControls();
          this.node = nextNode;
          this.nodeRef.value = nextNode;
          const nodeWidths = readTableWidths(nextNode);
          if (options.collaborative?.()) this.widths = nodeWidths;
          else if (nodeWidths) this.widths = nodeWidths;
          else if (!this.widths)
            this.widths = resolveTableWidths(nextNode, options.documentKey(), this.tableIndex);
        }
        this.syncColumns();
        this.persistWidths();
        this.refresh();
        return true;
      }

      stopEvent(event: Event) {
        const resizing = columnResizingPluginKey.getState(view.state);
        if (
          (event.type === 'mousedown' || event.type === 'pointerdown') &&
          resizing &&
          resizing.activeHandle >= 0
        )
          return false;
        const target = event.target;
        if (target instanceof Element && target.closest('a[href]')) return false;
        return super.stopEvent(event);
      }

      destroy() {
        clearTimeout(this.hideTimer);
        this.events.abort();
        refreshers.delete(this.refresh);
        super.destroy();
      }
    }
    return new ResizableTableView();
  });

  return {
    // 复用官方 Table Block，只替换其视图构造器以兼容 columnResizingPlugin。
    plugins: [
      tableWidthsRemark.options,
      tableWidthsRemark.plugin,
      ...tableBlock.filter((plugin) => plugin !== tableBlockView),
      viewPlugin,
    ],
    readonlyChanged: () => refreshers.forEach((refresh) => refresh()),
    configure(ctx: Ctx) {
      configureTables(ctx);
      ctx.update(tableBlockConfig.key, (config) => ({
        ...config,
        renderButton: (action) => {
          if (action.startsWith('add_')) return addIcon;
          if (action.startsWith('delete_')) return trashIcon;
          if (action.endsWith('drag_handle')) return moreIcon;
          if (action === 'align_col_left') return alignLeftIcon;
          if (action === 'align_col_center') return alignCenterIcon;
          if (action === 'align_col_right') return alignRightIcon;
          return labels[action];
        },
      }));
    },
  };
}
