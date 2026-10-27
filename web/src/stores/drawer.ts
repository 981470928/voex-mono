import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

export type EditorDrawer = 'documents' | 'attachments';

export const useDrawerStore = defineStore('drawer', () => {
  const activeDrawer = ref<EditorDrawer | null>(null);
  const documentOpen = computed(() => activeDrawer.value === 'documents');
  const attachmentOpen = computed(() => activeDrawer.value === 'attachments');

  function setOpen(drawer: EditorDrawer, open: boolean) {
    if (open) activeDrawer.value = drawer;
    else if (activeDrawer.value === drawer) activeDrawer.value = null;
  }

  function toggle(drawer: EditorDrawer) {
    setOpen(drawer, activeDrawer.value !== drawer);
  }

  function closeAll() {
    activeDrawer.value = null;
  }

  return { activeDrawer, documentOpen, attachmentOpen, setOpen, toggle, closeAll };
});
