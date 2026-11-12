<template>
  <div class="document-search" role="search" aria-label="文档搜索" @keydown="handleKeydown">
    <div class="document-search__row">
      <button
        type="button"
        class="document-search__tool document-search__tool--glyph"
        :class="{ 'document-search__tool--active': replaceOpen }"
        :title="replaceOpen ? '收起替换' : '展开替换'"
        :aria-label="replaceOpen ? '收起替换' : '展开替换'"
        :aria-expanded="replaceOpen"
        @click="toggleReplace"
      >
        <SvgIcon name="chevron-right" :size="12" class="document-search__replace-chevron" />
      </button>
      <div class="document-search__field">
        <input
          ref="searchInput"
          class="document-search__input"
          type="text"
          placeholder="查找"
          aria-label="查找"
          autocomplete="off"
          :value="inputValue"
          @input="updateQuery"
          @compositionstart="composing = true"
          @compositionend="endSearchComposition"
        />
        <button
          v-if="inputValue"
          type="button"
          class="document-search__clear"
          title="清空查找"
          aria-label="清空查找"
          @click="clearQuery"
        >
          ×
        </button>
      </div>
      <span class="document-search__count" role="status">{{ countText }}</span>
      <button
        type="button"
        class="document-search__tool"
        title="上一处（Shift + Enter）"
        aria-label="上一处"
        :disabled="!hasMatches"
        @click="emit('prev')"
      >
        <SvgIcon name="chevron-up" :size="16" />
      </button>
      <button
        type="button"
        class="document-search__tool"
        title="下一处（Enter）"
        aria-label="下一处"
        :disabled="!hasMatches"
        @click="emit('next')"
      >
        <SvgIcon name="chevron-down" :size="16" />
      </button>
      <button
        type="button"
        class="document-search__tool document-search__tool--glyph"
        :class="{ 'document-search__tool--active': caseSensitive }"
        role="switch"
        :aria-checked="caseSensitive"
        title="区分大小写"
        aria-label="区分大小写"
        @click="emit('update:case', !caseSensitive)"
      >
        Aa
      </button>
      <button
        type="button"
        class="document-search__tool document-search__tool--glyph"
        :class="{ 'document-search__tool--active': regex }"
        role="switch"
        :aria-checked="regex"
        title="正则表达式"
        aria-label="正则表达式"
        @click="emit('update:regex', !regex)"
      >
        .*
      </button>
      <button
        type="button"
        class="document-search__tool"
        title="关闭（Esc）"
        aria-label="关闭搜索"
        @click="emit('close')"
      >
        <SvgIcon name="close" :size="16" />
      </button>
    </div>
    <div v-if="replaceOpen" class="document-search__row document-search__row--replace">
      <div class="document-search__field document-search__field--replace">
        <input
          ref="replaceInput"
          v-model="replaceText"
          class="document-search__input"
          type="text"
          placeholder="替换"
          aria-label="替换为"
          autocomplete="off"
          @keydown.enter="handleReplaceEnter"
        />
      </div>
      <button
        type="button"
        class="document-search__button"
        :disabled="!canReplace || !hasMatches"
        :title="replaceTitle"
        @click="emit('replace-current', replaceText)"
      >
        替换
      </button>
      <button
        type="button"
        class="document-search__button"
        :disabled="!canReplace || !hasMatches"
        :title="replaceTitle"
        @click="emit('replace-all', replaceText)"
      >
        全部替换
      </button>
    </div>
    <p v-if="error" class="document-search__error" role="alert">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';

const props = defineProps<{
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  matchCount: number;
  currentIndex: number;
  error: string | null;
  canReplace: boolean;
}>();

const emit = defineEmits<{
  'update:query': [query: string];
  'update:case': [value: boolean];
  'update:regex': [value: boolean];
  next: [];
  prev: [];
  'replace-current': [replacement: string];
  'replace-all': [replacement: string];
  close: [];
}>();

const searchInput = ref<HTMLInputElement | null>(null);
const replaceInput = ref<HTMLInputElement | null>(null);
const replaceOpen = ref(false);
const replaceText = ref('');
const composing = ref(false);
// 本地镜像输入值：状态更新走微任务，受控值回流会吞掉快速输入。
const inputValue = ref(props.query);

watch(
  () => props.query,
  (value) => {
    if (value !== inputValue.value) inputValue.value = value;
  }
);

const hasMatches = computed(() => props.matchCount > 0);
const countText = computed(() => {
  if (props.error || !props.query) return '';
  return hasMatches.value ? `${props.currentIndex + 1} / ${props.matchCount}` : '无结果';
});
const replaceTitle = computed(() => (props.canReplace ? '替换' : '只读文档不可替换'));

function updateQuery(event: Event) {
  if (composing.value || (event as InputEvent).isComposing) return;
  inputValue.value = (event.target as HTMLInputElement).value;
  emit('update:query', inputValue.value);
}

function endSearchComposition(event: CompositionEvent) {
  composing.value = false;
  inputValue.value = (event.target as HTMLInputElement).value;
  emit('update:query', inputValue.value);
}

// IME 上屏的 Enter 不触发替换。
function handleReplaceEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  emit('replace-current', replaceText.value);
}

function clearQuery() {
  inputValue.value = '';
  emit('update:query', '');
  searchInput.value?.focus();
}

function toggleReplace() {
  replaceOpen.value = !replaceOpen.value;
  if (replaceOpen.value) replaceInput.value?.focus();
  else searchInput.value?.focus();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('close');
    return;
  }
  if (event.key !== 'Enter') return;
  // 替换框内的 Enter 已单独处理替换。
  if (event.target === replaceInput.value) return;
  event.preventDefault();
  if (event.shiftKey) emit('prev');
  else emit('next');
}

function focus() {
  searchInput.value?.focus();
  searchInput.value?.select();
}

onMounted(focus);

defineExpose({ focus });
</script>

<style scoped lang="stylus">
.document-search
  display flex
  flex-direction column
  gap 6px
  width max-content
  max-width unquote('min(440px, calc(100vw - 32px))')
  padding 8px
  border 1px solid var(--color-border-secondary)
  border-radius 8px
  background var(--color-bg-panel)
  box-shadow var(--shadow-medium)
  color var(--color-text-primary)
  font-size 13px
  pointer-events auto

  &__row
    display flex
    align-items center
    gap 4px

  &__row--replace
    padding-left 28px

  &__field
    position relative
    display flex
    align-items center
    flex 1 1 auto
    min-width 120px

  &__field--replace
    flex 1 1 auto

  &__input
    box-sizing border-box
    width 100%
    height 30px
    padding 0 26px 0 8px
    border 1px solid var(--color-border-secondary)
    border-radius 6px
    background var(--color-bg-secondary)
    color var(--color-text-primary)
    font-family inherit
    font-size 13px
    outline none

    &::placeholder
      color var(--color-text-tertiary)

    &:focus
      outline 2px solid var(--color-accent-tint)
      outline-offset -1px

  &__clear
    position absolute
    right 2px
    width 24px
    height 24px
    padding 0
    border 0
    border-radius 6px
    background transparent
    color var(--color-text-tertiary)
    font-size 16px
    line-height 1
    cursor pointer

    &:hover
      background var(--color-bg-translucent)
      color var(--color-text-primary)

  &__count
    flex-shrink 0
    min-width 36px
    color var(--color-text-secondary)
    font-size 12px
    text-align center
    white-space nowrap

    &:empty
      display none

  &__tool
    display inline-flex
    align-items center
    justify-content center
    flex-shrink 0
    min-width 28px
    height 28px
    padding 0 6px
    border 0
    border-radius 6px
    background transparent
    color var(--color-text-secondary)
    cursor pointer
    transition background .15s, color .15s

    &:hover:not(:disabled)
      background var(--color-bg-translucent)
      color var(--color-text-primary)

    &:active:not(:disabled)
      background var(--color-accent-tint)

    &:disabled
      opacity .45
      cursor not-allowed

  &__tool--glyph
    font-family inherit
    font-size 12px
    font-weight 600

  &__tool--active
    background var(--color-accent-tint)
    color var(--color-accent)

    &:hover:not(:disabled)
      background var(--color-accent-tint)
      color var(--color-accent)

  &__replace-chevron
    transform rotate(90deg)
    transition transform .15s

  &__button
    flex-shrink 0
    height 28px
    padding 0 10px
    border 1px solid var(--color-border-secondary)
    border-radius 6px
    background var(--color-bg-secondary)
    color var(--color-text-primary)
    font-family inherit
    font-size 12px
    cursor pointer
    transition background .15s

    &:hover:not(:disabled)
      background var(--color-bg-translucent)

    &:active:not(:disabled)
      background var(--color-accent-tint)

    &:disabled
      opacity .45
      cursor not-allowed

  &__error
    margin 0
    padding 0 2px
    color var(--color-red)
    font-size 12px

@media (prefers-reduced-motion: reduce)
  .document-search
    .document-search__tool, .document-search__button, .document-search__replace-chevron
      transition none
</style>
