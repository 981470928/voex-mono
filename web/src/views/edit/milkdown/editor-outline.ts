import type { EditorView } from '@milkdown/kit/prose/view';

export interface EditorOutlineItem {
  key: string;
  level: number;
  text: string;
  pos: number;
}

export function readEditorOutline(view: EditorView): EditorOutlineItem[] {
  const items: EditorOutlineItem[] = [];

  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true;

    const rawLevel = Number(node.attrs.level);
    const level = Number.isInteger(rawLevel) ? Math.min(6, Math.max(1, rawLevel)) : 1;
    items.push({
      key: `heading-${pos}-${level}`,
      level,
      text: node.textContent.replace(/\s+/gu, ' ').trim() || '未命名标题',
      pos,
    });
    return false;
  });

  return items;
}

export function editorOutlineElement(
  view: EditorView,
  item: EditorOutlineItem
): HTMLElement | null {
  const element = view.nodeDOM(item.pos);
  return element instanceof HTMLElement ? element : null;
}
