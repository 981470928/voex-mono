<template>
  <VoexModal
    :model-value="true"
    :title="editing ? '编辑公式' : '插入公式'"
    :width="680"
    @close="emit('close')"
  >
    <form :id="formId" class="latex-dialog" novalidate @submit.prevent="submit">
      <label :for="`${id}-code`">LaTeX 公式</label>
      <textarea
        :id="`${id}-code`"
        ref="codeInput"
        v-model="code"
        class="latex-dialog__code"
        style="resize: none"
        rows="4"
        spellcheck="false"
        autofocus
        placeholder="例如：\frac{a}{b} 或 E=mc^2"
        :aria-invalid="!!codeError"
        :aria-describedby="`${id}-code-feedback`"
        @compositionstart="composing = true"
        @compositionend="endComposition"
      />
      <p
        :id="`${id}-code-feedback`"
        class="latex-dialog__hint"
        :class="{ 'latex-dialog__hint--error': codeError }"
      >
        {{ codeError || '直接输入公式源码，无需添加 $ 或 $$。' }}
      </p>
      <div class="latex-dialog__settings">
        <div class="latex-dialog__field">
          <label :for="`${id}-color`">颜色（HEX）</label>
          <div class="latex-dialog__color">
            <span
              class="latex-dialog__swatch"
              :style="{ backgroundColor: validColor ? color : undefined }"
              aria-hidden="true"
            />
            <input
              :id="`${id}-color`"
              ref="colorInput"
              v-model="color"
              type="text"
              placeholder="#333333"
              autocomplete="off"
              spellcheck="false"
              :aria-invalid="!validColor"
              :aria-describedby="`${id}-color-feedback`"
            />
          </div>
          <p
            :id="`${id}-color-feedback`"
            class="latex-dialog__hint"
            :class="{ 'latex-dialog__hint--error': !validColor }"
          >
            {{ validColor ? '支持 #RGB、#RRGGBB' : '请输入有效 HEX 颜色' }}
          </p>
        </div>
        <div class="latex-dialog__field">
          <label :for="`${id}-height`">节点高度（px）</label>
          <input
            :id="`${id}-height`"
            ref="heightInput"
            v-model="height"
            type="number"
            min="1"
            step="1"
            :aria-invalid="!validHeight"
            :aria-describedby="`${id}-height-feedback`"
          />
          <p
            :id="`${id}-height-feedback`"
            class="latex-dialog__hint"
            :class="{ 'latex-dialog__hint--error': !validHeight }"
          >
            {{ validHeight ? '宽度始终为 100%' : '高度必须为大于 0 的整数' }}
          </p>
        </div>
        <div class="latex-dialog__field">
          <label :for="`${id}-size`">公式大小（px）</label>
          <input
            :id="`${id}-size`"
            ref="sizeInput"
            v-model="size"
            type="number"
            min="1"
            max="999"
            step="1"
            :aria-invalid="!validSize"
            :aria-describedby="`${id}-size-feedback`"
          />
          <p
            :id="`${id}-size-feedback`"
            class="latex-dialog__hint"
            :class="{ 'latex-dialog__hint--error': !validSize }"
          >
            {{ validSize ? '1–999，按字号等比缩放 SVG' : '大小必须为 1–999 的整数' }}
          </p>
        </div>
      </div>
      <div class="latex-dialog__preview-heading">
        <span>预览</span>
        <span class="latex-dialog__hint">居中对齐，超出节点部分隐藏</span>
      </div>
      <div class="latex-dialog__preview-scroll">
        <div
          class="milkdown-latex latex-dialog__preview"
          :style="previewStyle"
          role="img"
          :aria-label="`公式预览：${code}`"
          :aria-busy="rendering"
        >
          <div ref="preview" class="milkdown-latex__viewport" />
          <span
            v-if="rendering || !code.trim() || renderError"
            class="milkdown-latex__feedback"
            role="status"
          >
            {{ !code.trim() ? '输入 LaTeX 后显示公式' : rendering ? '正在生成预览…' : renderError }}
          </span>
        </div>
      </div>
      <div v-if="renderError" class="latex-dialog__retry">
        <button type="button" class="latex-dialog__button" @click="updatePreview">重新预览</button>
      </div>
      <p v-if="insertError" class="latex-dialog__hint latex-dialog__hint--error" role="alert">
        {{ insertError }}
      </p>
    </form>
    <template #footer>
      <button type="button" class="latex-dialog__button" @click="emit('close')">取消</button>
      <button
        type="submit"
        :form="formId"
        class="latex-dialog__button latex-dialog__button--primary"
        :disabled="rendering || composing || !renderedCode || !!renderError"
        @keydown="preventComposingSubmit"
      >
        {{ editing ? '保存公式' : '插入公式' }}
      </button>
    </template>
  </VoexModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { VoexModal } from '@/plugins/voex-modal';
import { DEFAULT_LATEX, HEX_COLOR, type LatexAttrs } from './latex';
import { renderLatex } from './latex-renderer';

const props = defineProps<{
  initial?: LatexAttrs;
  editing?: boolean;
  onInsert: (attrs: LatexAttrs) => void;
}>();
const emit = defineEmits<{ close: [] }>();
const id = useId();
const formId = `${id}-form`;
const themeColor = getComputedStyle(document.documentElement)
  .getPropertyValue('--color-text-primary')
  .trim();
const initial = props.initial ?? {
  ...DEFAULT_LATEX,
  color: HEX_COLOR.test(themeColor) ? themeColor : DEFAULT_LATEX.color,
};
const code = ref(initial.code);
const color = ref(initial.color);
const height = ref<string | number>(initial.height);
const size = ref<string | number>(initial.size);
const codeInput = ref<HTMLTextAreaElement>();
const colorInput = ref<HTMLInputElement>();
const heightInput = ref<HTMLInputElement>();
const sizeInput = ref<HTMLInputElement>();
const preview = ref<HTMLDivElement>();
const rendering = ref(false);
const composing = ref(false);
const renderedCode = ref('');
const renderError = ref('');
const insertError = ref('');
const submitted = ref(false);
let version = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const validColor = computed(() => HEX_COLOR.test(color.value));
const validHeight = computed(
  () => Number.isSafeInteger(Number(height.value)) && Number(height.value) > 0
);
const validSize = computed(
  () => Number.isInteger(Number(size.value)) && Number(size.value) >= 1 && Number(size.value) <= 999
);
const codeError = computed(() =>
  submitted.value && !code.value.trim() ? '请输入 LaTeX 公式' : renderError.value
);
const previewStyle = computed(() => ({
  height: `${validHeight.value ? Number(height.value) : DEFAULT_LATEX.height}px`,
  fontSize: `${validSize.value ? Number(size.value) : DEFAULT_LATEX.size}px`,
  color: validColor.value ? color.value : DEFAULT_LATEX.color,
}));

async function updatePreview() {
  if (timer) clearTimeout(timer);
  const current = ++version;
  const source = code.value;
  renderedCode.value = '';
  renderError.value = '';
  insertError.value = '';
  preview.value?.replaceChildren();
  if (!source.trim()) {
    rendering.value = false;
    return;
  }
  rendering.value = true;
  try {
    const svg = await renderLatex(source);
    if (current !== version) return;
    preview.value?.replaceChildren(svg);
    renderedCode.value = source;
  } catch (cause) {
    if (current === version)
      renderError.value = cause instanceof Error ? cause.message : '预览失败，请检查公式后重试';
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
  rendering.value = !!code.value.trim();
  if (!composing.value) timer = setTimeout(() => void updatePreview(), 150);
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
  if (!validColor.value) {
    colorInput.value?.focus();
    return;
  }
  if (!validHeight.value) {
    heightInput.value?.focus();
    return;
  }
  if (!validSize.value) {
    sizeInput.value?.focus();
    return;
  }
  try {
    props.onInsert({
      code: code.value,
      color: color.value,
      height: Number(height.value),
      size: Number(size.value),
    });
    emit('close');
  } catch (cause) {
    insertError.value = cause instanceof Error ? cause.message : '公式插入失败，请重试';
  }
}
watch(code, schedulePreview, { immediate: true, flush: 'sync' });
onBeforeUnmount(() => {
  version++;
  if (timer) clearTimeout(timer);
});
</script>

<style scoped lang="stylus">
.latex-dialog
  display flex
  flex-direction column
  gap 8px

  label
    font-size 13px
    color var(--color-text-primary)

  input, textarea
    box-sizing border-box
    width 100%
    min-width 0
    padding 8px 10px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-panel)
    color var(--color-text-primary)
    font inherit
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 1px
    &[aria-invalid='true']
      border-color var(--color-red)

  &__code
    min-height 112px
    font-family Consolas, 'Courier New', monospace !important

  &__settings
    display grid
    grid-template-columns repeat(3, minmax(0, 1fr))
    gap 16px

  &__field
    display flex
    flex-direction column
    gap 6px

  &__color
    position relative
    input
      padding-left 36px

  &__swatch
    position absolute
    left 10px
    top 50%
    width 16px
    height 16px
    transform translateY(-50%)
    border 1px solid var(--color-border-primary)
    border-radius 3px

  &__hint
    margin 0
    min-height 20px
    font-size 12px
    color var(--color-text-tertiary)
    &--error
      color var(--color-red)

  &__preview-heading
    display flex
    flex-wrap wrap
    align-items center
    justify-content space-between
    gap 4px
    margin-top 8px
    font-size 13px

  &__preview-scroll
    max-height 320px
    overflow auto
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-panel)

  &__preview
    margin 0

  &__retry
    text-align right

.latex-dialog__button
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

@media (max-width: 520px)
  .latex-dialog__settings
    grid-template-columns 1fr
    gap 8px
</style>
