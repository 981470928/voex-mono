<template>
  <VoexModal
    :model-value="visible"
    :width="400"
    :closable="false"
    :mask-closable="false"
    :title="title"
    :aria-describedby="contentId"
    @close="hide"
  >
    <div class="confirm-dialog">
      <div class="confirm-dialog__icon" :class="`confirm-dialog__icon--${type}`" aria-hidden="true">
        <svg
          v-if="type === MessageType.SUCCESS"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M9 12l2 2 4-4"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
        </svg>
        <svg
          v-else-if="type === MessageType.ERROR"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
          <path
            d="M15 9l-6 6M9 9l6 6"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        <svg
          v-else-if="type === MessageType.WARNING"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path d="M12 9v4m0 4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <path
            d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            stroke="currentColor"
            stroke-width="2"
          />
        </svg>
        <svg
          v-else-if="type === MessageType.INFO"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
          <path
            d="M12 16v-4m0-4h.01"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </div>
      <div :id="contentId" class="confirm-dialog__body">{{ content }}</div>
    </div>
    <template #footer>
      <button
        type="button"
        class="confirm-dialog__btn confirm-dialog__btn--cancel"
        autofocus
        @click="hide"
      >
        {{ cancelText }}
      </button>
      <button
        type="button"
        class="confirm-dialog__btn confirm-dialog__btn--confirm"
        :class="`confirm-dialog__btn--${type}`"
        @click="handleConfirm"
      >
        {{ confirmText }}
      </button>
    </template>
  </VoexModal>
</template>

<script setup lang="ts">
import { ref, useId } from 'vue';
import { VoexModal } from '@/plugins/voex-modal';
import { ModalType } from '@/stores/modal';
import { useModal } from '@/composables/useModal';
import { MessageType } from '@/constant/status';

const type = ref<MessageType>(MessageType.INFO);
const title = ref('提示');
const content = ref('');
const confirmText = ref('确认');
const cancelText = ref('取消');
const contentId = useId();
const state = ref<{
  onOK: () => void;
  onCancel: () => void;
}>();

const { visible, hide } = useModal(
  ModalType.CONFIRM,
  (data) => {
    type.value = data.type ?? MessageType.INFO;
    title.value = data.title ?? '提示';
    content.value = data.content;
    confirmText.value = data.confirmText ?? '确认';
    cancelText.value = data.cancelText ?? '取消';
    state.value = {
      onOK: data.onOK,
      onCancel: data.onCancel,
    };
  },
  () => {
    const current = state.value;
    state.value = undefined;
    current?.onCancel?.();
  }
);

function handleConfirm() {
  const current = state.value;
  if (!visible.value || !current) return;
  // Clear before hide: onLeave must not also dispatch cancellation.
  state.value = undefined;
  hide();
  current.onOK();
}
</script>

<style scoped lang="stylus">
.confirm-dialog
  display flex
  gap 12px
  align-items flex-start

.confirm-dialog__icon
  flex-shrink 0
  width 40px
  height 40px
  border-radius 50%
  display flex
  align-items center
  justify-content center

  &--success
    background rgba(40, 167, 69, 0.1)
    color var(--color-green)

  &--error
    background rgba(220, 53, 69, 0.1)
    color var(--color-red)

  &--warning
    background rgba(255, 193, 7, 0.1)
    color var(--color-yellow)

  &--info
    background rgba(23, 162, 184, 0.1)
    color var(--color-blue)

  &--none
    background var(--color-bg-translucent)
    color var(--color-text-secondary)

.confirm-dialog__body
  flex 1
  min-width 0
  overflow-wrap anywhere

.confirm-dialog__title
  margin 0
  font-size 16px
  font-weight 600
  color var(--color-text-primary)
  line-height 22px

.confirm-dialog__content
  margin 8px 0 0
  font-size 14px
  color var(--color-text-secondary)
  line-height 1.6

.confirm-dialog__btn
  height 32px
  padding 0 16px
  font-size 14px
  border-radius 6px
  border 1px solid var(--color-border-primary)
  cursor pointer
  transition all 0.2s

  &:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset 2px

  &:active
    filter brightness(0.95)

  &--cancel
    background var(--color-bg-panel)
    color var(--color-text-primary)

    &:hover
      border-color var(--color-accent)
      color var(--color-accent)

  &--confirm
    background var(--color-brand-bg)
    border-color var(--color-brand-bg)
    color var(--color-brand-text)

    &:hover
      opacity 0.85

    &.confirm-dialog__btn--error
      background var(--color-red)
      border-color var(--color-red)

    &.confirm-dialog__btn--warning
      background var(--color-yellow)
      border-color var(--color-yellow)
      color var(--color-black)

    &.confirm-dialog__btn--success
      background var(--color-green)
      border-color var(--color-green)
</style>
