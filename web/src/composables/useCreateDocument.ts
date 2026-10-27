import { onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { createDocument, type CreateDocumentInput } from '@/service/api/document-api';
import { ModalType, useModalStore } from '@/stores/modal';
import { useNotificationStore } from '@/stores/notification';

export function useCreateDocument() {
  const creating = ref(false);
  const router = useRouter();
  const route = useRoute();
  const modal = useModalStore();
  const notification = useNotificationStore();
  let active = true;
  onBeforeUnmount(() => {
    active = false;
  });

  function openCreateDocument(target: Omit<CreateDocumentInput, 'file_name'> = {}) {
    if (!active || creating.value) return;
    const destination = {
      ...target,
      team_key:
        target.team_key ??
        (typeof route.query.team_key === 'string' ? route.query.team_key : undefined),
    };
    modal.showModal(ModalType.INPUT_DIALOG, {
      title: '创建文件',
      tips: '文件名称',
      defaultValue: '未命名',
      okText: '创建',
      onOK: async (name) => {
        if (!active || creating.value) return;
        creating.value = true;
        const from = router.currentRoute.value.fullPath;
        try {
          const result = await createDocument({ ...destination, file_name: name });
          const path = [result.project_name, ...result.folder_path].join(' / ');
          notification.show(`已创建到 ${path}，即将打开文件`, 'success', 4000);
          // Close the input before showing the destination for one full second.
          modal.hideModal(ModalType.INPUT_DIALOG);
          await new Promise<void>((resolve) => setTimeout(resolve, 1000));
          if (active && router.currentRoute.value.fullPath === from) {
            await router.push({ name: 'edit', params: { file_key: result.file_key } });
          }
        } finally {
          creating.value = false;
        }
      },
    });
  }

  return { creating, openCreateDocument };
}
