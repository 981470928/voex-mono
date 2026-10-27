<template>
  <VoexModal
    :model-value="visible"
    :width="420"
    :closable="false"
    :mask-closable="false"
    :title="title"
    :busy="submitting"
    @close="handleCancel"
  >
    <label :for="inputId" class="input-dialog__tips">{{ tips || title || '请输入内容' }}</label>
    <input
      :id="inputId"
      ref="inputRef"
      v-model="inputValue"
      class="input-dialog__input"
      type="text"
      required
      maxlength="255"
      autofocus
      :readonly="submitting"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
      @input="error = ''"
      @compositionstart="composing = true"
      @compositionend="handleCompositionEnd"
      @keydown.enter="handleEnter"
    />
    <p :id="errorId" class="input-dialog__error" role="alert">{{ error }}</p>
    <template #footer>
      <button
        type="button"
        class="input-dialog__btn input-dialog__btn--cancel"
        :disabled="submitting"
        @click="handleCancel"
      >
        {{ cancelText }}
      </button>
      <button
        type="button"
        class="input-dialog__btn input-dialog__btn--ok"
        :class="{ 'input-dialog__btn--busy': submitting }"
        :disabled="submitting"
        :aria-label="submitting ? '正在提交' : undefined"
        @click="handleOK"
      >
        <span class="input-dialog__btn-text">{{ okText }}</span>
        <span v-if="submitting" class="input-dialog__spinner" aria-hidden="true" />
      </button>
    </template>
  </VoexModal>
</template>

<script setup lang="ts">
import { ref, useId } from 'vue';
import { VoexModal } from '@/plugins/voex-modal';
import { ModalType } from '@/stores/modal';
import { useModal } from '@/composables/useModal';
const title = ref('');
const tips = ref('');
const inputValue = ref('');
const okText = ref('确认');
const cancelText = ref('取消');
const inputRef = ref<HTMLInputElement | null>(null);
const inputId = useId();
const errorId = `${inputId}-error`;
const error = ref('');
const submitting = ref(false);
const composing = ref<boolean>(false);
let compositionEndedAt = -Infinity;
const state = ref<{
  onOK: (value: string) => void | Promise<void>;
  onCancel?: () => void;
}>();
const { visible, hide } = useModal(
  ModalType.INPUT_DIALOG,
  (data) => {
    title.value = data.title;
    tips.value = data.tips ?? '';
    inputValue.value = data.defaultValue ?? '';
    okText.value = data.okText ?? '确认';
    cancelText.value = data.cancelText ?? '取消';
    error.value = '';
    submitting.value = false;
    composing.value = false;
    compositionEndedAt = -Infinity;
    state.value = { onOK: data.onOK, onCancel: data.onCancel };
  },
  () => {
    const current = state.value;
    state.value = undefined;
    submitting.value = false;
    current?.onCancel?.();
  }
);

function handleCompositionEnd(event: CompositionEvent) {
  composing.value = false;
  compositionEndedAt = event.timeStamp;
}

function handleEnter(event: KeyboardEvent) {
  // Some IMEs end composition immediately before dispatching the confirming Enter.
  if (event.isComposing || composing.value || event.timeStamp - compositionEndedAt < 50) return;
  event.preventDefault();
  if (!event.repeat) void handleOK();
}

function getErrorMessage(cause: unknown): string {
  const serverError = (cause as { response?: { data?: { error?: unknown } } } | null)?.response
    ?.data?.error;
  if (typeof serverError === 'string' && serverError.trim()) return serverError;
  return cause instanceof Error && cause.message ? cause.message : '提交失败，请重试';
}

async function handleOK() {
  const current = state.value;
  if (!visible.value || !current || submitting.value || composing.value) return;
  const value = inputValue.value.trim();
  if (!value || value.length > 255) {
    error.value = value ? '内容不能超过 255 个字符' : '请输入内容';
    inputRef.value?.focus();
    return;
  }
  inputValue.value = value;
  error.value = '';
  submitting.value = true;
  try {
    await current.onOK(value);
  } catch (cause: unknown) {
    if (state.value === current && visible.value) {
      error.value = getErrorMessage(cause);
      inputRef.value?.focus();
    }
    return;
  } finally {
    if (state.value === current) submitting.value = false;
  }
  // An older request must never close a newly opened input dialog.
  if (state.value !== current || !visible.value) return;
  state.value = undefined;
  hide();
}

function handleCancel() {
  if (submitting.value) return;
  hide();
}
</script>

<style scoped lang="stylus">
.input-dialog
  display flex
  flex-direction column
  gap 8px

.input-dialog__title
  margin 0
  font-size 16px
  font-weight 600
  color var(--color-text-primary)
  line-height 22px

.input-dialog__tips
  display block
  margin-bottom 8px
  font-size 13px
  color var(--color-text-secondary)
  line-height 1.5
  overflow-wrap anywhere

.input-dialog__error
  min-height 20px
  margin 6px 0 0
  color var(--color-red)
  font-size 13px
  line-height 20px
  overflow-wrap anywhere

.input-dialog__input
  width 100%
  height 36px
  padding 0 10px
  font-size 14px
  color var(--color-text-primary)
  background var(--color-bg-panel)
  border 1px solid var(--color-border-primary)
  border-radius 6px
  outline none
  box-sizing border-box
  transition border-color 0.2s, box-shadow 0.2s

  &::placeholder
    color var(--color-text-tertiary)

  &:focus
    border-color var(--color-accent)
    box-shadow 0 0 0 2px var(--voex-focus-ring)

  &[aria-invalid='true']
    border-color var(--color-red)

  &:read-only
    color var(--color-text-secondary)

.input-dialog__btn
  position relative
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

  &:disabled
    cursor not-allowed
    opacity 0.6

  &:not(:disabled):active
    filter brightness(0.95)

  &--busy .input-dialog__btn-text
    visibility hidden

  &--cancel
    background var(--color-bg-panel)
    color var(--color-text-primary)

    &:not(:disabled):hover
      border-color var(--color-accent)
      color var(--color-accent)

  &--ok
    background var(--color-brand-bg)
    border-color var(--color-brand-bg)
    color var(--color-brand-text)

    &:not(:disabled):hover
      opacity 0.85

.input-dialog__spinner
  position absolute
  inset 0
  margin auto
  width 16px
  height 16px
  border 2px solid currentColor
  border-right-color transparent
  border-radius 50%
  animation input-dialog-spin 0.7s linear infinite

@keyframes input-dialog-spin
  to
    transform rotate(360deg)

@media (prefers-reduced-motion: reduce)
  .input-dialog__spinner
    animation none
</style>
