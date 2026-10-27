import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { TextSelection } from '@milkdown/kit/prose/state';

import {
  createTextColorSchema,
  normalizeHexColor,
  type TextColorKind,
} from '@voex/editor-schema/text-color';
export { normalizeHexColor, type TextColorKind } from '@voex/editor-schema/text-color';

export function createTextColorExtension() {
  const { marks } = createTextColorSchema();

  function enabled(ctx: Ctx, kind: TextColorKind): boolean {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const type = state.schema.marks[kind];
    if (!view.editable || view.isDestroyed || !type || !(state.selection instanceof TextSelection))
      return false;
    const { from, to, empty, $from } = state.selection;
    if (empty)
      return (
        $from.parent.type.allowsMarkType(type) &&
        !(state.storedMarks ?? $from.marks()).some((mark) => mark.type.spec.code)
      );
    let applicable = false;
    state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (
        node.isText &&
        parent?.type.allowsMarkType(type) &&
        !node.marks.some((mark) => mark.type.spec.code)
      )
        applicable = true;
    });
    return applicable;
  }

  function selected(ctx: Ctx, kind: TextColorKind): string | null {
    const { state } = ctx.get(editorViewCtx);
    const type = state.schema.marks[kind];
    if (!type) return null;
    const { from, to, empty, $from } = state.selection;
    if (empty)
      return normalizeHexColor(type.isInSet(state.storedMarks ?? $from.marks())?.attrs.color);
    let color: string | null | undefined;
    state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return;
      const value = normalizeHexColor(type.isInSet(node.marks)?.attrs.color);
      color = color === undefined ? value : color === value ? color : null;
    });
    return color ?? null;
  }

  function active(ctx: Ctx, kind: TextColorKind): boolean {
    const { state } = ctx.get(editorViewCtx);
    const type = state.schema.marks[kind];
    if (!type) return false;
    return state.selection.empty
      ? !!type.isInSet(state.storedMarks ?? state.selection.$from.marks())
      : state.doc.rangeHasMark(state.selection.from, state.selection.to, type);
  }

  function apply(ctx: Ctx, kind: TextColorKind, value: string | null) {
    if (!enabled(ctx, kind)) throw new Error('请将光标移到正文或选中可设置颜色的文字');
    const color = value === null ? null : normalizeHexColor(value);
    if (value !== null && !color) throw new Error('请输入 HEX 颜色，例如 #F00 或 #FF0000');
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const type = state.schema.marks[kind]!;
    const { from, to, empty } = state.selection;
    const tr = state.tr;
    if (empty) {
      if (color) tr.addStoredMark(type.create({ color }));
      else tr.removeStoredMark(type);
    } else if (color) {
      const mark = type.create({ color });
      state.doc.nodesBetween(from, to, (node, position, parent) => {
        if (
          node.isInline &&
          parent?.type.allowsMarkType(type) &&
          !node.marks.some((existing) => existing.type.spec.code)
        )
          tr.addMark(Math.max(from, position), Math.min(to, position + node.nodeSize), mark);
      });
    } else tr.removeMark(from, to, type);
    view.dispatch(tr.scrollIntoView());
  }

  return { plugins: marks, enabled, selected, active, apply };
}
