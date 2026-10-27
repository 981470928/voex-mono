import { useModalStore, ModalType, type ModalDataType } from '@/stores/modal';
import type { MessageType } from '@/constant/status';

export interface ConfirmOptions {
  type?: MessageType;
  title?: string;
  content: string;
  confirmText?: string;
  cancelText?: string;
}

/**
 * 确认对话框 composable
 *
 * 返回一个 `confirm` 函数，调用后弹出确认框，返回 Promise<boolean>。
 * 用户点击确认 resolve(true)，点击取消 resolve(false)。
 *
 * @example
 * ```ts
 * import { useConfirm } from '@/composables/useConfirm';
 * import { MessageType } from '@/constant/status';
 *
 * const { confirm } = useConfirm();
 *
 * const ok = await confirm({
 *   type: MessageType.WARNING,
 *   title: '删除确认',
 *   content: '确定要删除该文档吗？此操作不可撤销。',
 *   confirmText: '删除',
 *   cancelText: '再想想',
 * });
 *
 * if (ok) {
 *   // 执行删除
 * }
 * ```
 */
export function useConfirm() {
  const modalStore = useModalStore();

  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      modalStore.showModal(ModalType.CONFIRM, {
        ...options,
        onOK: () => resolve(true),
        onCancel: () => resolve(false),
      } as ModalDataType[ModalType.CONFIRM]);
    });
  }

  return { confirm };
}
