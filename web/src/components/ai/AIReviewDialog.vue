<template>
  <VoexModal
    :model-value="!!review"
    title="审阅 AI 修改"
    :width="1100"
    :busy="applying"
    :mask-closable="false"
    @update:model-value="!$event && emit('close')"
  >
    <div v-if="review" class="ai-review">
      <div class="ai-review__summary">
        <span
          >{{ review.changes.length }} 个文件 ·
          {{ review.status === 'applied' ? '已应用并保存' : '待应用，原文件尚未改变' }}</span
        >
        <span class="ai-review__legend">
          <span class="ai-review__added">＋ 新增</span>
          <span class="ai-review__removed">− 删除（删除线）</span>
        </span>
      </div>
      <label class="ai-field" for="ai-review-file"
        >文件
        <select id="ai-review-file" v-model.number="selected" :disabled="applying">
          <option
            v-for="(item, index) in review.changes"
            :key="`${item.file_key}:${index}`"
            :value="index"
          >
            {{ item.kind === 'create' ? '新建 · ' : '' }}{{ item.after_name }}
          </option>
        </select>
      </label>
      <template v-if="change">
        <p
          v-if="change.before_name !== change.after_name && change.kind !== 'create'"
          class="ai-review__rename"
        >
          重命名：{{ change.before_name }} → {{ change.after_name }}
        </p>
        <div class="ai-review__controls">
          <span>只读 · 文档差异</span>
          <span v-if="previewReady">{{ differences }} 处差异</span>
        </div>
        <p v-if="previewError" class="ai-review__error" role="alert">
          {{ previewError }}
          <button type="button" class="ai-button" :disabled="applying" @click="retryPreview">
            重新加载
          </button>
        </p>
        <p v-else-if="!previewReady" class="ai-review__status" role="status">正在计算文档差异…</p>
        <div
          class="ai-review__document"
          :class="{ 'ai-review__document--loading': !previewReady }"
          :aria-busy="!previewReady && !previewError"
          :aria-hidden="!previewReady || undefined"
          :inert="!previewReady"
          tabindex="0"
          aria-label="文档修改对比，只读"
        >
          <MilkdownProvider :key="previewKey">
            <MilkdownEditor
              :default-value="change.before_content"
              :diff-after="change.after_content"
              readonly
              :show-toolbar="false"
              :show-outline="false"
              :show-minimap="false"
              :code-mirror-enabled="false"
              :allow-attachments="false"
              @diff-ready="onDiffReady"
              @load-error="onPreviewError"
            />
          </MilkdownProvider>
        </div>
        <p v-if="previewReady && differences === 0" class="ai-review__empty">
          {{ change.kind === 'create' ? '新建空白文档' : '正文没有变化' }}
        </p>
      </template>
      <p v-if="review.status === 'applied'" class="ai-review__note">
        当前展示已应用的历史快照，关闭不会更改当前文档。
      </p>
      <p v-else class="ai-review__note">
        “应用并保存”会应用本次审阅的全部文件。取消后仍可从对话中的“审阅修改”重新打开；原文件变化时，旧建议不会覆盖新内容。
      </p>
    </div>
    <template #footer>
      <div class="ai-actions">
        <button class="ai-button" :disabled="applying" @click="emit('close')">
          {{ review?.status === 'applied' ? '关闭' : '取消' }}
        </button>
        <button
          v-if="review?.status !== 'applied'"
          class="ai-button ai-button--primary"
          :disabled="applying || !canApply || !previewReady || !!previewError"
          :aria-busy="applying"
          @click="emit('apply')"
        >
          应用并保存
        </button>
      </div>
    </template>
  </VoexModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { MilkdownProvider } from '@milkdown/vue';
import VoexModal from '@/plugins/voex-modal/VoexModal.vue';
import MilkdownEditor from '@/views/edit/milkdown/MilkdownEditor.vue';
import type { ReviewSnapshot } from '@/agent/types';
import './ai.styl';

const props = defineProps<{
  review: ReviewSnapshot | null;
  applying: boolean;
  canApply: boolean;
}>();
const emit = defineEmits<{ close: []; apply: [] }>();
const selected = ref(0);
const previewAttempt = ref(0);
const previewReady = ref(false);
const previewError = ref('');
const differences = ref(0);
const change = computed(() => props.review?.changes[selected.value]);
const previewKey = computed(
  () => `${props.review?.id}:${selected.value}:${change.value?.file_key}:${previewAttempt.value}`
);

function resetPreview() {
  previewReady.value = false;
  previewError.value = '';
  differences.value = 0;
}
function onDiffReady(count: number) {
  previewError.value = '';
  differences.value = count;
  previewReady.value = true;
}
function onPreviewError(message: string) {
  if (!previewError.value) previewError.value = message;
  previewReady.value = false;
}
function retryPreview() {
  resetPreview();
  previewAttempt.value++;
}
watch(
  () => props.review?.id,
  () => {
    selected.value = 0;
    previewAttempt.value = 0;
    resetPreview();
  }
);
watch(selected, resetPreview);
</script>

<style lang="stylus">
.ai-review
  display flex
  flex-direction column
  gap 14px
  color var(--color-text-primary)
  &__summary, &__controls, &__legend
    display flex
    align-items center
    justify-content space-between
    flex-wrap wrap
    gap 8px 16px
    font-size 12px
    color var(--color-text-secondary)
  &__legend
    justify-content flex-start
  &__added
    color var(--color-green)
  &__removed
    color var(--color-red)
  &__rename
    margin 0
    font-size 13px
  &__document
    min-height 180px
    max-height 52vh
    overflow auto
    border 1px solid var(--color-border-secondary)
    border-radius 6px
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px
    &--loading .milkdown-editor
      visibility hidden
    .milkdown-editor
      min-height 0
      max-width none
      background transparent
    .milkdown-editor__content
      min-height 180px
      max-width none
      padding 16px 20px 24px
  &__error
    display flex
    align-items center
    justify-content space-between
    gap 12px
    margin 0
    color var(--color-red)
    font-size 13px
  &__note, &__empty, &__status
    margin 0
    color var(--color-text-tertiary)
    font-size 12px
    line-height 1.6
</style>
