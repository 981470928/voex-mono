<template>
  <VoexModal
    :model-value="true"
    :title="editing ? '编辑流程图' : '插入流程图'"
    :width="900"
    @close="emit('close')"
  >
    <form :id="formId" class="mermaid-dialog" novalidate @submit.prevent="submit">
      <div class="mermaid-dialog__columns">
        <div class="mermaid-dialog__source">
          <label :for="`${id}-code`" class="mermaid-dialog__label">Mermaid 源码</label>
          <textarea
            :id="`${id}-code`"
            ref="codeInput"
            v-model="code"
            class="mermaid-dialog__code"
            style="resize: none"
            rows="14"
            spellcheck="false"
            autofocus
            placeholder="flowchart TD&#10;  A[开始] --> B[完成]"
            :aria-invalid="!!codeError"
            :aria-describedby="`${id}-code-feedback`"
            @compositionstart="startComposition"
            @compositionend="endComposition"
          />
          <p
            :id="`${id}-code-feedback`"
            class="mermaid-dialog__hint"
            :class="{ 'mermaid-dialog__hint--error': codeError }"
            aria-live="polite"
          >
            {{ codeError || '修改源码后自动预览，无需添加 ```mermaid 标记。' }}
          </p>
        </div>
        <div class="mermaid-dialog__result">
          <span :id="`${id}-preview-label`" class="mermaid-dialog__label">实时预览</span>
          <div
            class="mermaid-dialog__preview"
            role="group"
            :aria-labelledby="`${id}-preview-label`"
            :aria-busy="rendering"
          >
            <div ref="preview" class="mermaid-dialog__viewport" />
            <p v-if="!renderedCode" class="mermaid-dialog__status" role="status">
              {{
                !code.trim()
                  ? '输入 Mermaid 源码后显示流程图'
                  : composing
                    ? '输入完成后更新预览'
                    : rendering
                      ? '正在生成预览…'
                      : '暂时无法预览，请检查源码后重试'
              }}
            </p>
          </div>
          <div class="mermaid-dialog__preview-footer">
            <span class="mermaid-dialog__hint">插入后仍可编辑源码。</span>
            <button
              v-if="renderError"
              type="button"
              class="mermaid-dialog__button"
              @click="updatePreview"
            >
              重新预览
            </button>
          </div>
        </div>
      </div>
      <p v-if="insertError" class="mermaid-dialog__hint mermaid-dialog__hint--error" role="alert">
        {{ insertError }}
      </p>
    </form>
    <template #footer>
      <button type="button" class="mermaid-dialog__button" @click="emit('close')">取消</button>
      <button
        type="submit"
        :form="formId"
        class="mermaid-dialog__button mermaid-dialog__button--primary"
        :disabled="
          rendering || composing || !renderedCode || renderedCode !== code || !!renderError
        "
        @keydown="preventComposingSubmit"
      >
        {{ editing ? '保存流程图' : '插入流程图' }}
      </button>
    </template>
  </VoexModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { VoexModal } from '@/plugins/voex-modal';
import { useThemeStore } from '@/stores/theme';
import { DEFAULT_MERMAID_CODE } from './mermaid';
import { renderMermaid } from './mermaid-renderer';

const props = defineProps<{
  initial?: string;
  editing?: boolean;
  onInsert: (code: string) => void;
}>();
const emit = defineEmits<{ close: [] }>();
const id = useId();
const formId = `${id}-form`;
const theme = useThemeStore();
const code = ref(props.initial ?? DEFAULT_MERMAID_CODE);
const codeInput = ref<HTMLTextAreaElement>();
const preview = ref<HTMLDivElement>();
const composing = ref(false);
const rendering = ref(false);
const renderedCode = ref('');
const renderError = ref('');
const insertError = ref('');
const submitted = ref(false);
let version = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const codeError = computed(() =>
  submitted.value && !code.value.trim() ? '请输入 Mermaid 源码' : renderError.value
);

async function updatePreview() {
  if (timer) clearTimeout(timer);
  const current = ++version;
  const source = code.value;
  renderedCode.value = '';
  renderError.value = '';
  insertError.value = '';
  preview.value?.replaceChildren();
  if (composing.value || !source.trim()) {
    rendering.value = false;
    return;
  }
  rendering.value = true;
  try {
    const svg = await renderMermaid(source);
    if (current !== version) return;
    preview.value?.replaceChildren(svg);
    renderedCode.value = source;
  } catch (cause) {
    if (current === version)
      renderError.value = cause instanceof Error ? cause.message : '预览失败，请检查源码后重试';
  } finally {
    if (current === version) rendering.value = false;
  }
}

function schedulePreview() {
  version++;
  if (timer) clearTimeout(timer);
  renderedCode.value = '';
  renderError.value = '';
  insertError.value = '';
  preview.value?.replaceChildren();
  rendering.value = !composing.value && !!code.value.trim();
  if (!composing.value) timer = setTimeout(() => void updatePreview(), 200);
}
function startComposition() {
  composing.value = true;
  schedulePreview();
}
function endComposition() {
  composing.value = false;
  schedulePreview();
}
function preventComposingSubmit(event: KeyboardEvent) {
  if (event.isComposing) event.preventDefault();
}
function submit() {
  if (composing.value || rendering.value) return;
  submitted.value = true;
  if (!code.value.trim() || renderError.value || renderedCode.value !== code.value) {
    codeInput.value?.focus();
    return;
  }
  try {
    props.onInsert(code.value);
    emit('close');
  } catch (cause) {
    insertError.value = cause instanceof Error ? cause.message : '流程图插入失败，请重试';
  }
}
watch([code, () => theme.resolved], schedulePreview, { immediate: true, flush: 'sync' });
onBeforeUnmount(() => {
  version++;
  if (timer) clearTimeout(timer);
});
</script>

<style scoped lang="stylus">
.mermaid-dialog
  display flex
  flex-direction column
  gap 12px

  &__columns
    display grid
    grid-template-columns minmax(0, 1fr) minmax(0, 1fr)
    gap 20px

  &__source, &__result
    display flex
    flex-direction column
    gap 8px
    min-width 0

  &__label
    font-size 13px
    color var(--color-text-primary)

  &__code
    box-sizing border-box
    width 100%
    min-height 320px
    height 320px
    padding 12px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-panel)
    color var(--color-text-primary)
    font-family Consolas, 'Courier New', monospace
    font-size 13px
    line-height 1.7
    tab-size 2
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 1px
    &[aria-invalid='true']
      border-color var(--color-red)

  &__hint
    min-height 20px
    margin 0
    color var(--color-text-tertiary)
    font-size 12px
    line-height 1.6
    overflow-wrap anywhere
    white-space pre-wrap
    &--error
      color var(--color-red)

  &__preview
    position relative
    box-sizing border-box
    height 320px
    overflow auto
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-panel)

  &__viewport
    display flex
    align-items center
    justify-content center
    height 100%
    min-height 100%
    box-sizing border-box
    padding 16px
    :deep(svg)
      display block
      max-width 100%
      max-height 100%
      height auto
      flex-shrink 0

  &__status
    position absolute
    inset 0
    display flex
    align-items center
    justify-content center
    margin 0
    padding 20px
    color var(--color-text-secondary)
    font-size 13px
    text-align center

  &__preview-footer
    display flex
    align-items flex-start
    justify-content space-between
    gap 8px
    min-height 36px

.mermaid-dialog__button
  min-width 86px
  min-height 36px
  padding 0 14px
  border 1px solid var(--color-border-primary)
  border-radius 6px
  background var(--color-bg-panel)
  color var(--color-text-primary)
  font inherit
  cursor pointer
  &:hover:not(:disabled)
    filter brightness(1.15)
  &:active:not(:disabled)
    filter brightness(.9)
  &:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset 2px
  &:disabled
    cursor not-allowed
    opacity .6
  &--primary
    background var(--color-brand-bg)
    color var(--color-brand-text)
    border-color var(--color-brand-bg)

@media (max-width: 720px)
  .mermaid-dialog
    &__columns
      grid-template-columns 1fr
      gap 16px
    &__code
      min-height 220px
      height 220px
    &__preview
      height 260px
</style>
