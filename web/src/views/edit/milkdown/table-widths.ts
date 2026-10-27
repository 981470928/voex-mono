import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { TableMap } from '@milkdown/kit/prose/tables';
import type { MarkdownNode } from '@milkdown/kit/transformer';

export type TableColumnWidth = number | null;

const MIN_COLUMN_WIDTH = 1;
const MAX_COLUMN_WIDTH = 10000;
const MAX_COLUMN_COUNT = 1000;
const STORAGE_PREFIX = 'voex-table-widths:';
const COMMENT_PATTERN = /^\s*<!--\s*voex-table-widths:\s*(\[[^\]]*\])\s*-->\s*$/i;

interface TableWidthsRecord {
  signature: string;
  widths: TableColumnWidth[];
}

interface TableWidthsStore {
  version: 1;
  tables: Record<string, TableWidthsRecord>;
}

export function normalizeColumnWidth(value: unknown): number | null {
  const width =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(width) && width >= MIN_COLUMN_WIDTH && width <= MAX_COLUMN_WIDTH
    ? width
    : null;
}

export function normalizeColwidth(value: unknown, size = 1): number[] | null {
  if (!Array.isArray(value) || value.length !== size) return null;
  const widths = value.map(normalizeColumnWidth);
  return widths.some((width) => width !== null) ? widths.map((width) => width ?? 0) : null;
}

export function fitTableWidths(
  widths: readonly TableColumnWidth[] | null,
  columnCount: number
): TableColumnWidth[] | null {
  if (!widths) return null;
  return Array.from({ length: columnCount }, (_, index) => widths[index] ?? null);
}

function isTableWidthsComment(value: unknown): boolean {
  return typeof value === 'string' && /^\s*<!--\s*voex-table-widths:/i.test(value);
}

export function hasLegacyTableWidthMetadata(markdown: string): boolean {
  return /(^|\n)\s*<!--\s*voex-table-widths:/i.test(markdown);
}

function parseTableWidthsComment(value: unknown): TableColumnWidth[] | null {
  if (typeof value !== 'string') return null;
  const match = value.match(COMMENT_PATTERN);
  if (!match) return null;

  try {
    const parsed: unknown = JSON.parse(match[1]!);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_COLUMN_COUNT)
      return null;

    const widths = parsed.map((item) => (item === null ? null : normalizeColumnWidth(item)));
    if (widths.some((width, index) => parsed[index] !== null && width === null)) return null;
    return widths.some((width) => width !== null) ? widths : null;
  } catch {
    return null;
  }
}

export function readTableWidths(node: ProseMirrorNode): TableColumnWidth[] | null {
  const map = TableMap.get(node);
  const widths: TableColumnWidth[] = Array.from({ length: map.width }, () => null);
  for (let row = 0; row < map.height; row++) {
    for (let column = 0; column < map.width; column++) {
      const pos = map.map[row * map.width + column];
      if (pos === undefined) continue;
      const cell = node.nodeAt(pos);
      if (!cell) continue;
      const index = column - map.colCount(pos);
      const width = normalizeColumnWidth(
        Array.isArray(cell.attrs.colwidth) ? cell.attrs.colwidth[index] : null
      );
      if (width !== null && widths[column] === null) widths[column] = width;
    }
  }

  return widths.some((width) => width !== null) ? widths : null;
}

export function tableSignature(node: ProseMirrorNode): string {
  const map = TableMap.get(node);
  return `${map.width}x${map.height}:${node.textBetween(0, node.content.size, '\u0000')}`;
}

function storageKey(documentKey: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(documentKey || 'anonymous')}`;
}

function readStore(documentKey: string): TableWidthsStore | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(documentKey)) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const store = parsed as Partial<TableWidthsStore>;
    if (store.version !== 1 || !store.tables || typeof store.tables !== 'object') return null;
    return store as TableWidthsStore;
  } catch {
    return null;
  }
}

function writeStore(documentKey: string, store: TableWidthsStore): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(documentKey), JSON.stringify(store));
  } catch {
    // Storage can be disabled by the browser; editing must continue without persistence.
  }
}

function normalizeStoredWidths(value: unknown): TableColumnWidth[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COLUMN_COUNT) return null;
  const widths = value.map((item) => (item === null ? null : normalizeColumnWidth(item)));
  return widths.some((width, index) => value[index] !== null && width === null) ? null : widths;
}

export function resolveTableWidths(
  node: ProseMirrorNode,
  documentKey: string,
  tableIndex: number
): TableColumnWidth[] | null {
  const nodeWidths = readTableWidths(node);
  if (nodeWidths) return nodeWidths;
  if (tableIndex < 0) return null;

  const record = readStore(documentKey)?.tables[String(tableIndex)];
  if (!record || record.signature !== tableSignature(node)) return null;
  return normalizeStoredWidths(record.widths);
}

export function persistTableWidths(
  documentKey: string,
  tableIndex: number,
  widths: TableColumnWidth[] | null,
  signature: string
): void {
  if (tableIndex < 0) return;
  const store = readStore(documentKey) ?? { version: 1, tables: {} };
  const key = String(tableIndex);
  if (widths?.some((width) => width !== null)) {
    store.tables[key] = { signature, widths: widths.map((width) => width ?? null) };
  } else {
    delete store.tables[key];
  }
  writeStore(documentKey, store);
}

export function applyTableWidths(
  table: HTMLTableElement,
  colgroup: HTMLTableColElement,
  widths: readonly TableColumnWidth[],
  defaultCellMinWidth: number
): void {
  while (colgroup.childElementCount > widths.length) colgroup.lastElementChild?.remove();
  while (colgroup.childElementCount < widths.length)
    colgroup.appendChild(table.ownerDocument.createElement('col'));

  let totalWidth = 0;
  let fixedWidth = true;
  widths.forEach((width, index) => {
    const col = colgroup.children[index] as HTMLElement;
    const cssWidth = width === null ? '' : `${width}px`;
    if (col.style.width !== cssWidth) col.style.width = cssWidth;
    totalWidth += width ?? defaultCellMinWidth;
    if (width === null) fixedWidth = false;
  });

  table.style.width = fixedWidth ? `${totalWidth}px` : '';
  table.style.minWidth = fixedWidth ? '' : `${totalWidth}px`;
}

function annotateTableWidths(table: MarkdownNode, widths: readonly TableColumnWidth[]): void {
  table.children?.forEach((row) => {
    if (row.type !== 'tableRow') return;
    let column = 0;
    row.children?.forEach((cell) => {
      if (cell.type !== 'tableCell') return;
      const colspan = Math.max(1, Number(cell.colspan) || 1);
      const colwidth = widths.slice(column, column + colspan).map((width) => width ?? 0);
      if (colwidth.some((width) => width > 0)) cell.colwidth = colwidth;
      else delete cell.colwidth;
      column += colspan;
    });
  });
}

// Remove legacy metadata comments so they never become document content again.
export function restoreTableWidths(tree: MarkdownNode): void {
  const children = tree.children;
  if (!children) return;

  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    const isLegacyMetadata =
      child.type === 'html' && typeof child.value === 'string' && isTableWidthsComment(child.value);
    if (isLegacyMetadata) {
      const widths = parseTableWidthsComment(child.value);
      const table = children[index + 1];
      if (widths && table?.type === 'table') annotateTableWidths(table, widths);
      children.splice(index, 1);
      index--;
      continue;
    }
    restoreTableWidths(child);
  }
}
