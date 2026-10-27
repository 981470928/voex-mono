import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { TextSelection } from '@milkdown/kit/prose/state';
import { closeHistory } from '@milkdown/kit/prose/history';
import { yUndoPluginKey } from 'y-prosemirror';
import { createFontSizeSchema, normalizeFontSize } from '@voex/editor-schema/font-size';

export { FONT_SIZE_PRESETS, normalizeFontSize } from '@voex/editor-schema/font-size';

export function createFontSizeExtension() {
  const { fontSize } = createFontSizeSchema();

  function enabled(ctx: Ctx): boolean {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const type = state.schema.marks.fontSize;
    if (!view.editable || view.isDestroyed || !type || !(state.selection instanceof TextSelection))
      return false;
    const { from, to, empty, $from } = state.selection;
    if (empty)
      return (
        !$from.parent.type.spec.code &&
        $from.parent.type.allowsMarkType(type) &&
        !(state.storedMarks ?? $from.marks()).some((mark) => mark.type.spec.code)
      );
    let applicable = false;
    state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (
        node.isText &&
        parent?.type.allowsMarkType(type) &&
        !parent.type.spec.code &&
        !node.marks.some((mark) => mark.type.spec.code)
      )
        applicable = true;
    });
    return applicable;
  }

  function selected(ctx: Ctx): number | 'mixed' | null {
    const { state } = ctx.get(editorViewCtx);
    const type = state.schema.marks.fontSize;
    if (!type) return null;
    const { from, to, empty, $from } = state.selection;
    if (empty)
      return normalizeFontSize(type.isInSet(state.storedMarks ?? $from.marks())?.attrs.size);
    let result: number | null | undefined;
    let mixed = false;
    state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (
        !node.isText ||
        !parent?.type.allowsMarkType(type) ||
        parent.type.spec.code ||
        node.marks.some((mark) => mark.type.spec.code)
      )
        return;
      const size = normalizeFontSize(type.isInSet(node.marks)?.attrs.size);
      if (result === undefined) result = size;
      else if (result !== size) mixed = true;
    });
    return mixed ? 'mixed' : (result ?? null);
  }

  function apply(ctx: Ctx, value: string | number | null) {
    if (!enabled(ctx)) throw new Error('请将光标移到正文或选中可设置字号的文字');
    const size = value === null ? null : normalizeFontSize(value);
    if (value !== null && size === null) throw new Error('字号须为 8–96px，步长为 0.5px');
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const type = state.schema.marks.fontSize!;
    const { from, to, empty } = state.selection;
    const tr = closeHistory(state.tr);
    if (empty) {
      if (size !== null) tr.addStoredMark(type.create({ size }));
      else tr.removeStoredMark(type);
    } else {
      state.doc.nodesBetween(from, to, (node, pos, parent) => {
        if (
          !node.isText ||
          !parent?.type.allowsMarkType(type) ||
          parent.type.spec.code ||
          node.marks.some((mark) => mark.type.spec.code)
        )
          return;
        const start = Math.max(from, pos);
        const end = Math.min(to, pos + node.nodeSize);
        if (size === null) tr.removeMark(start, end, type);
        else tr.addMark(start, end, type.create({ size }));
      });
    }
    // One size selection is one undo step, separate from adjacent typing.
    const manager = yUndoPluginKey.getState(state)?.undoManager;
    manager?.stopCapturing();
    view.dispatch(tr.scrollIntoView());
    manager?.stopCapturing();
  }

  return { plugins: [fontSize], enabled, selected, apply };
}
