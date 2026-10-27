import { ref, shallowReactive, computed, markRaw, nextTick, type Component } from 'vue';
import { defineStore } from 'pinia';
import ConfirmDialog from '@/components/dialog/ConfirmDialog.vue';
import InputDialog from '@/components/dialog/InputDialog.vue';
import AIModelDialog from '@/components/ai/AIModelDialog.vue';
import AIReviewDialog from '@/components/ai/AIReviewDialog.vue';
import FileDetailsDialog from '@/components/files/FileDetailsDialog.vue';
import FileViewerDialog from '@/components/dialog/FileViewerDialog.vue';
import JoinTeamDialog from '@/components/team/JoinTeamDialog.vue';
import ProjectPrivilegesDialog from '@/components/team/ProjectPrivilegesDialog.vue';
import ShareDialog from '@/components/share/ShareDialog.vue';
import LocalDraftDialog from '@/components/share/LocalDraftDialog.vue';
import EmojiDialog from '@/views/edit/milkdown/EmojiDialog.vue';
import PexelsDialog from '@/views/edit/milkdown/PexelsDialog.vue';
import LatexDialog from '@/views/edit/milkdown/LatexDialog.vue';
import MermaidDialog from '@/views/edit/milkdown/MermaidDialog.vue';
import type { MessageType } from '@/constant/status';

export enum ModalType {
  CONFIRM,
  INPUT_DIALOG,
  AI_MODEL_DIALOG,
  AI_REVIEW_DIALOG,
  FILE_DETAILS_DIALOG,
  FILE_VIEWER_DIALOG,
  JOIN_TEAM_DIALOG,
  PROJECT_PRIVILEGES_DIALOG,
  SHARE_DIALOG,
  LOCAL_DRAFT_DIALOG,
  EMOJI_DIALOG,
  PEXELS_DIALOG,
  LATEX_DIALOG,
  MERMAID_DIALOG,
}

type DialogProps<C> = C extends new (...args: never[]) => { $props: infer P }
  ? Omit<P, 'modelValue' | 'onUpdate:modelValue' | 'onClose'>
  : never;

export interface HostedModalProps {
  [ModalType.AI_MODEL_DIALOG]: DialogProps<typeof AIModelDialog>;
  [ModalType.AI_REVIEW_DIALOG]: DialogProps<typeof AIReviewDialog>;
  [ModalType.FILE_DETAILS_DIALOG]: DialogProps<typeof FileDetailsDialog>;
  [ModalType.FILE_VIEWER_DIALOG]: DialogProps<typeof FileViewerDialog>;
  [ModalType.JOIN_TEAM_DIALOG]: DialogProps<typeof JoinTeamDialog>;
  [ModalType.PROJECT_PRIVILEGES_DIALOG]: DialogProps<typeof ProjectPrivilegesDialog>;
  [ModalType.SHARE_DIALOG]: DialogProps<typeof ShareDialog>;
  [ModalType.LOCAL_DRAFT_DIALOG]: DialogProps<typeof LocalDraftDialog>;
  [ModalType.EMOJI_DIALOG]: DialogProps<typeof EmojiDialog>;
  [ModalType.PEXELS_DIALOG]: DialogProps<typeof PexelsDialog>;
  [ModalType.LATEX_DIALOG]: DialogProps<typeof LatexDialog>;
  [ModalType.MERMAID_DIALOG]: DialogProps<typeof MermaidDialog>;
}

export type HostedModalType = keyof HostedModalProps;
export type ModalDataType = {
  [ModalType.CONFIRM]: {
    type?: MessageType;
    title?: string;
    content: string;
    confirmText?: string;
    cancelText?: string;
    onOK: () => void;
    onCancel: () => void;
  };
  [ModalType.INPUT_DIALOG]: {
    title: string;
    tips?: string;
    defaultValue?: string;
    onOK: (value: string) => void | Promise<void>;
    onCancel?: () => void;
    okText?: string;
    cancelText?: string;
  };
} & {
  [T in HostedModalType]: { props: HostedModalProps[T]; onCancel?: () => void };
};

export type ModalInstanceMap<T extends ModalType> = Record<
  T,
  {
    component: Component;
    onDemand?: boolean;
    onEnter?: (data: ModalDataType[T]) => void;
    onLeave?: () => void;
  }
>;

export const useModalStore = defineStore('modal', () => {
  const modalInstanceMap = ref<ModalInstanceMap<ModalType>>({
    [ModalType.CONFIRM]: { component: markRaw(ConfirmDialog) },
    [ModalType.INPUT_DIALOG]: { component: markRaw(InputDialog) },
    [ModalType.AI_MODEL_DIALOG]: {
      component: markRaw(AIModelDialog),
      onDemand: true,
    },
    [ModalType.AI_REVIEW_DIALOG]: {
      component: markRaw(AIReviewDialog),
      onDemand: true,
    },
    [ModalType.FILE_DETAILS_DIALOG]: {
      component: markRaw(FileDetailsDialog),
      onDemand: true,
    },
    [ModalType.FILE_VIEWER_DIALOG]: {
      component: markRaw(FileViewerDialog),
      onDemand: true,
    },
    [ModalType.JOIN_TEAM_DIALOG]: {
      component: markRaw(JoinTeamDialog),
      onDemand: true,
    },
    [ModalType.PROJECT_PRIVILEGES_DIALOG]: {
      component: markRaw(ProjectPrivilegesDialog),
      onDemand: true,
    },
    [ModalType.SHARE_DIALOG]: {
      component: markRaw(ShareDialog),
      onDemand: true,
    },
    [ModalType.LOCAL_DRAFT_DIALOG]: {
      component: markRaw(LocalDraftDialog),
      onDemand: true,
    },
    [ModalType.EMOJI_DIALOG]: {
      component: markRaw(EmojiDialog),
      onDemand: true,
    },
    [ModalType.PEXELS_DIALOG]: {
      component: markRaw(PexelsDialog),
      onDemand: true,
    },
    [ModalType.LATEX_DIALOG]: {
      component: markRaw(LatexDialog),
      onDemand: true,
    },
    [ModalType.MERMAID_DIALOG]: {
      component: markRaw(MermaidDialog),
      onDemand: true,
    },
  });
  const showModalList = ref<ModalType[]>([]);
  // Shallow storage preserves callback identity and keeps File/editor payloads out of deep proxies.
  const modalData = shallowReactive<Partial<{ [T in ModalType]: ModalDataType[T] }>>({});
  const sessions = shallowReactive<Partial<Record<ModalType, number>>>({});
  const pendingShows = new Map<ModalType, { data: ModalDataType[ModalType] }>();
  let nextSession = 0;
  const modelControlled = new Set<ModalType>([
    ModalType.AI_MODEL_DIALOG,
    ModalType.FILE_DETAILS_DIALOG,
    ModalType.JOIN_TEAM_DIALOG,
    ModalType.PROJECT_PRIVILEGES_DIALOG,
    ModalType.SHARE_DIALOG,
    ModalType.LOCAL_DRAFT_DIALOG,
  ]);

  const renderedModals = computed(() => {
    const persistent = Object.keys(modalInstanceMap.value)
      .map(Number)
      .filter((type) => !modalInstanceMap.value[type as ModalType].onDemand);
    // Newly opened dialogs mount last so native modal focus follows opening order.
    const types = [
      ...persistent,
      ...showModalList.value.filter((type) => modalInstanceMap.value[type].onDemand),
    ];
    return types.map((value) => {
      const type = value as ModalType;
      const entry = modalInstanceMap.value[type];
      const data = modalData[type];
      return {
        type,
        component: entry.component,
        key: entry.onDemand ? `${type}-${sessions[type] ?? 0}` : `${type}`,
        props:
          data && 'props' in data
            ? {
                ...data.props,
                ...(modelControlled.has(type)
                  ? {
                      modelValue: true,
                      'onUpdate:modelValue': (visible: boolean) => {
                        if (!visible) hideModal(type);
                      },
                    }
                  : { onClose: () => hideModal(type) }),
              }
            : {},
      };
    });
  });

  const showModal = <T extends ModalType>(modalType: T, data: ModalDataType[T]) => {
    if (showModalList.value.includes(modalType)) {
      data.onCancel?.();
      return false;
    }
    modalData[modalType] = data;
    sessions[modalType] = ++nextSession;
    showModalList.value.push(modalType);
    if (modalInstanceMap.value[modalType].onDemand) return true;
    const request = { data };
    pendingShows.set(modalType, request);
    nextTick(() => {
      if (pendingShows.get(modalType) !== request) return;
      pendingShows.delete(modalType);
      modalInstanceMap.value[modalType].onEnter?.(request.data);
    });
    return true;
  };

  const updateModal = <T extends HostedModalType>(
    modalType: T,
    data: ModalDataType[T],
    previous: ModalDataType[T]
  ) => {
    if (modalData[modalType] !== previous || !showModalList.value.includes(modalType)) return false;
    modalData[modalType] = data;
    return true;
  };

  const hideModal = (modalType: ModalType) => {
    const index = showModalList.value.indexOf(modalType);
    if (index === -1) return;
    const data = modalData[modalType];
    const pending = pendingShows.get(modalType);
    pendingShows.delete(modalType);
    delete modalData[modalType];
    showModalList.value.splice(index, 1);
    if (modalInstanceMap.value[modalType].onDemand) data?.onCancel?.();
    else if (pending) pending.data.onCancel?.();
    else modalInstanceMap.value[modalType].onLeave?.();
  };

  return {
    modalInstanceMap,
    showModalList,
    modalData,
    renderedModals,
    showModal,
    updateModal,
    hideModal,
  };
});
