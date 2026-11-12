import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { TextSelection } from '@milkdown/kit/prose/state';
import { closeHistory } from '@milkdown/kit/prose/history';
import { yUndoPluginKey } from 'y-prosemirror';
import { createFontFamilySchema } from '@voex/editor-schema/font-family';

import { normalizeFontFamily } from '@voex/editor-schema/font-catalog';
import { ensureFontStyles } from '@/utils/editor-fonts';
import { $prose } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';

export function createFontFamilyExtension(onError: (message: string) => void) {
  const { fontFamily } = createFontFamilySchema();

  function enabled(ctx: Ctx): boolean {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const type = state.schema.marks.fontFamily;
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

  function selected(ctx: Ctx): string | null {
    const { state } = ctx.get(editorViewCtx);
    const type = state.schema.marks.fontFamily;
    if (!type) return null;
    const { from, to, empty, $from } = state.selection;
    if (empty)
      return normalizeFontFamily(type.isInSet(state.storedMarks ?? $from.marks())?.attrs.family);
    let result: string | null | undefined;
    let mixed = false;
    state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (
        !node.isText ||
        !parent?.type.allowsMarkType(type) ||
        parent.type.spec.code ||
        node.marks.some((mark) => mark.type.spec.code)
      )
        return;
      const family = normalizeFontFamily(type.isInSet(node.marks)?.attrs.family);
      if (result === undefined) result = family;
      else if (result !== family) mixed = true;
    });
    return mixed ? 'mixed' : (result ?? null);
  }

  function apply(ctx: Ctx, value: string | null) {
    if (!enabled(ctx)) throw new Error('请将光标移到正文或选中可设置字体的文字');
    const family = value === null ? null : normalizeFontFamily(value);
    if (value !== null && family === null) throw new Error('不支持的字体，请重新选择');
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const type = state.schema.marks.fontFamily!;
    const { from, to, empty } = state.selection;
    const tr = closeHistory(state.tr);
    if (empty) {
      if (family !== null) tr.addStoredMark(type.create({ family }));
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
        if (family === null) tr.removeMark(start, end, type);
        else tr.addMark(start, end, type.create({ family }));
      });
    }
    // A font choice is one undo step, separate from adjacent typing.
    // 每次字体选择对应一个独立的撤销步骤，与相邻的文字输入分开。
    const manager = yUndoPluginKey.getState(state)?.undoManager;
    manager?.stopCapturing();
    view.dispatch(tr.scrollIntoView());
    manager?.stopCapturing();
  }

  const loading = $prose(
    () =>
      new Plugin({
        view: (view) => {
          let used = new Set<string>();
          const refresh = (doc: ProseNode) => {
            const next = new Set<string>();
            doc.descendants((node) => {
              for (const mark of node.marks) {
                if (mark.type.name === 'fontFamily') {
                  const id = normalizeFontFamily(mark.attrs.family);
                  if (id) next.add(id);
                }
              }
            });
            for (const id of next)
              if (!used.has(id))
                void ensureFontStyles(id).catch(() =>
                  onError('文档字体加载失败，暂用系统字体；可重新选择字体重试')
                );
            used = next;
          };
          refresh(view.state.doc);
          return {
            update(nextView, previous) {
              if (nextView.state.doc !== previous.doc) refresh(nextView.state.doc);
            },
          };
        },
      })
  );
  return { plugins: [fontFamily, loading], enabled, selected, apply };
}
