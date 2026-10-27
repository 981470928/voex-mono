<template>
  <VoexModal
    :model-value="modelValue"
    title="复制本地内容"
    :width="680"
    @close="$emit('update:modelValue', false)"
  >
    <div class="local-draft">
      <p :id="descriptionId">下方是当前页面保留的 Markdown。复制并另存后，再重新加载服务器内容。</p>
      <textarea
        ref="field"
        class="local-draft__content"
        style="resize: none"
        :aria-describedby="descriptionId"
        aria-label="本地 Markdown 内容"
        :value="content"
        readonly
        spellcheck="false"
        autofocus
        @focus="field?.select()"
      />
      <p v-if="copyError" class="local-draft__error" role="alert">{{ copyError }}</p>
    </div>
    <template #footer>
      <button type="button" class="local-draft__button" @click="copy">复制内容</button>
    </template>
  </VoexModal>
</template>

<script setup lang="ts">
import { ref, useId } from 'vue';
import { VoexModal } from '@/plugins/voex-modal';
import { useNotificationStore } from '@/stores/notification';

const props = defineProps<{ modelValue: boolean; content: string }>();
defineEmits<{ 'update:modelValue': [value: boolean] }>();
const field = ref<HTMLTextAreaElement>();
const copyError = ref('');
const descriptionId = useId();
const notification = useNotificationStore();

async function copy() {
  copyError.value = '';
  try {
    await navigator.clipboard.writeText(props.content);
    notification.show('本地内容已复制', 'success');
  } catch {
    field.value?.focus();
    field.value?.select();
    copyError.value = '浏览器未允许复制。内容已选中，请使用 Ctrl / ⌘ C 复制。';
  }
}
</script>

<style scoped lang="stylus">
.local-draft
  display grid
  gap 12px
  font-size 13px
  line-height 1.7
  color var(--color-text-secondary)
  &__content
    box-sizing border-box
    width 100%
    height 320px
    max-height 50dvh
    padding 12px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-primary)
    color var(--color-text-primary)
    font 13px/1.6 'Cascadia Code', Consolas, monospace
  &__error
    color var(--color-red)
  &__button
    min-height 36px
    padding 6px 16px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background var(--color-bg-panel)
    color var(--color-text-primary)
    cursor pointer
    &:hover
      color var(--color-accent)
      border-color var(--color-accent)
    &:active
      background var(--color-accent-tint)
  &__button:focus-visible, &__content:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset 2px
</style>
