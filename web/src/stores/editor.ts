import { computed, shallowRef } from 'vue';
import { defineStore } from 'pinia';

// Plain snapshot only: positions are ProseMirror document offsets, not Markdown indices.
// 仅保存普通快照：位置表示 ProseMirror 文档偏移量，而非 Markdown 索引。
export interface EditorSelection {
  editorId: string;
  documentKey: string;
  type: string;
  anchor: number;
  head: number;
  from: number;
  to: number;
  empty: boolean;
  selectedText: string;
  focused: boolean;
}

export const useEditorStore = defineStore('editor', () => {
  const selection = shallowRef<EditorSelection | null>(null);
  // The moving endpoint of a selection, or the caret position for an empty selection.
  // 选区中移动的一端；选区为空时表示光标位置。
  const cursorPosition = computed(() => selection.value?.head ?? null);
  const selectedText = computed(() => selection.value?.selectedText ?? '');

  function setSelection(value: EditorSelection) {
    const current = selection.value;
    // A background editor must not replace the last active editor's selection.
    // 后台编辑器不得替换最后一个活动编辑器的选区。
    if (current && current.editorId !== value.editorId && !value.focused) return;
    selection.value = value;
  }

  function clearSelection(editorId: string) {
    if (selection.value?.editorId === editorId) selection.value = null;
  }

  return { selection, cursorPosition, selectedText, setSelection, clearSelection };
});
