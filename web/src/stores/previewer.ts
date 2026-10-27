import { computed } from 'vue';
import { defineStore } from 'pinia';
import type { FileInfo } from '@/service/api/document-api';
import { downloadFile } from '@/service/api/upload-api';
import { ModalType, useModalStore } from '@/stores/modal';

export const usePreviewerStore = defineStore('previewer', () => {
  const modal = useModalStore();
  const type = ModalType.FILE_VIEWER_DIALOG;
  const visible = computed(() => modal.showModalList.includes(type));
  const file = computed(() => modal.modalData[type]?.props.file);

  function showFile(value: File) {
    const data = { props: { file: value } };
    const previous = modal.modalData[type];
    if (previous && modal.updateModal(type, data, previous)) return;
    modal.showModal(type, data);
  }

  async function open(fileKey: string, fileData: FileInfo) {
    const blob = await downloadFile(fileKey, fileData.hash);
    if (blob) showFile(new File([blob], fileData.name, { type: fileData.mime }));
  }

  function close() {
    modal.hideModal(type);
  }

  return { visible, file, open, showFile, close };
});
