import { onScopeDispose, watch } from 'vue';
import {
  useModalStore,
  type HostedModalProps,
  type HostedModalType,
  type ModalDataType,
} from '@/stores/modal';

interface DialogOptions<T extends HostedModalType> {
  visible: () => boolean;
  props: () => HostedModalProps[T];
  onClose: () => void;
  key?: () => unknown;
}

/** Bind caller state to the registered global dialog; dispose only this caller's session. */
export function useDialog<T extends HostedModalType>(type: T, options: DialogOptions<T>) {
  const store = useModalStore();
  let request: ModalDataType[T] | undefined;
  let sessionKey: unknown;
  let suppressClose = false;

  function hideOwned() {
    if (!request || store.modalData[type] !== request) return;
    suppressClose = true;
    try {
      store.hideModal(type);
    } finally {
      request = undefined;
      suppressClose = false;
    }
  }

  watch(
    () => {
      const visible = options.visible();
      return {
        visible,
        props: visible ? options.props() : undefined,
        key: visible ? options.key?.() : undefined,
      };
    },
    ({ visible, props, key }) => {
      if (!visible || !props) {
        hideOwned();
        return;
      }
      if (request && !Object.is(key, sessionKey)) hideOwned();
      const data = {
        props,
        onCancel: () => {
          request = undefined;
          if (!suppressClose) options.onClose();
        },
      } as ModalDataType[T];
      if (request && store.updateModal(type, data, request)) {
        request = data;
        return;
      }
      sessionKey = key;
      request = data;
      store.showModal(type, data);
    },
    { immediate: true, flush: 'post' }
  );
  onScopeDispose(hideOwned);
}
