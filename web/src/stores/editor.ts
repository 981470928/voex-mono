import { computed, shallowRef } from 'vue';
import { defineStore } from 'pinia';

// Plain snapshot only: positions are ProseMirror document offsets, not Markdown indices.
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
  const cursorPosition = computed(() => selection.value?.head ?? null);
  const selectedText = computed(() => selection.value?.selectedText ?? '');

  function setSelection(value: EditorSelection) {
    const current = selection.value;
    // A background editor must not replace the last active editor's selection.
    if (current && current.editorId !== value.editorId && !value.focused) return;
    selection.value = value;
  }

  function clearSelection(editorId: string) {
    if (selection.value?.editorId === editorId) selection.value = null;
  }

  return { selection, cursorPosition, selectedText, setSelection, clearSelection };
});
