import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useModalStore } from '@/stores/modal';
import type { ModalType, ModalDataType } from '@/stores/modal';
/**
 * Modal 组件内部使用的 composable
 *
 * 用于在 Modal 子组件中获取当前 modal 的显示状态、数据，以及关闭方法。
 *
 * @param modalType - 当前组件对应的 ModalType 枚举值
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useModal } from '@/composables/useModal';
 * import { ModalType } from '@/stores/modal';
 *
 * const { visible, data, hide } = useModal(ModalType.TODO_LIST);
 *
 * watch(visible, (show) => {
 *   if (show && data.value) {
 *     // modal 打开时，data.value 已正确推断为对应类型
 *   }
 * });
 * </script>
 * ```
 */
export function useModal<T extends ModalType>(
  modalType: T,
  onEnter?: (data: ModalDataType[T]) => void,
  onExit?: () => void
) {
  const store = useModalStore();
  const { showModalList, modalInstanceMap } = storeToRefs(store);

  /** 当前 modal 是否可见 */
  const visible = computed(() => showModalList.value.includes(modalType));

  if (onEnter) {
    modalInstanceMap.value[modalType].onEnter = onEnter as (data: ModalDataType[ModalType]) => void;
  }
  if (onExit) {
    modalInstanceMap.value[modalType].onLeave = onExit;
  }

  return {
    visible,
    onEnter,
    onExit,
    hide: () => {
      store.hideModal(modalType);
    },
  };
}
