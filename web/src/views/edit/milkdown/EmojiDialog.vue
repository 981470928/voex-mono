<template>
  <VoexModal :model-value="true" title="插入表情" :width="560" @close="emit('close')">
    <div class="emoji-dialog">
      <label :for="searchId" class="emoji-dialog__label">搜索表情</label>
      <div class="emoji-dialog__search">
        <input
          :id="searchId"
          ref="searchInput"
          v-model="query"
          type="search"
          class="emoji-dialog__input"
          placeholder="按名称或分类搜索"
          autocomplete="off"
          autofocus
          @input="updateSearch"
          @compositionstart="composing = true"
          @compositionend="endComposition"
        />
        <button
          v-if="query"
          type="button"
          class="emoji-dialog__clear"
          aria-label="清空搜索"
          @click="clearSearch"
        >
          ×
        </button>
      </div>
      <div class="emoji-dialog__categories" role="group" aria-label="表情分类">
        <button
          v-for="category in categories"
          :key="category"
          type="button"
          class="emoji-dialog__category"
          :aria-pressed="selectedCategory === category"
          @click="selectedCategory = category"
        >
          {{ category || '全部' }}
        </button>
      </div>
      <p class="emoji-dialog__count" role="status">{{ filteredEmojis.length }} 个表情</p>
      <div ref="resultsElement" class="emoji-dialog__results">
        <div v-if="filteredEmojis.length" class="emoji-dialog__grid" aria-label="表情搜索结果">
          <button
            v-for="emoji in filteredEmojis"
            :key="emoji.codes"
            type="button"
            class="emoji-dialog__emoji"
            :title="`${emoji.name} · ${emoji.category}`"
            :aria-label="`${emoji.name}，${emoji.category}`"
            @click="emit('select', emoji)"
          >
            <img
              v-if="!failedImages.has(emoji.codes)"
              :src="getTwemojiUrl(emoji)"
              alt=""
              width="28"
              height="28"
              loading="lazy"
              draggable="false"
              referrerpolicy="no-referrer"
              @error="failedImages.add(emoji.codes)"
            />
            <span v-else aria-hidden="true">{{ emoji.char }}</span>
          </button>
        </div>
        <p v-else class="emoji-dialog__empty">没有找到表情，请更换关键词或分类。</p>
      </div>
      <p v-if="failedImages.size" class="emoji-dialog__hint">
        部分表情图片无法加载，已显示系统表情，仍可插入。
      </p>
      <p class="emoji-dialog__credit">
        图形由
        <a href="https://github.com/jdecked/twemoji" target="_blank" rel="noopener noreferrer"
          >Twemoji</a
        >
        提供，遵循
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noopener noreferrer"
          >CC BY 4.0</a
        >。
      </p>
    </div>
  </VoexModal>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { VoexModal } from '@/plugins/voex-modal';
import emojis, { getTwemojiUrl, type Emoji } from '@/constant/emoji';

const emit = defineEmits<{ close: []; select: [emoji: Emoji] }>();
const searchId = useId();
const searchInput = ref<HTMLInputElement>();
const resultsElement = ref<HTMLDivElement>();
const query = ref('');
const committedQuery = ref('');
const selectedCategory = ref('');
const failedImages = ref(new Set<string>());
const categories = ['', ...new Set(emojis.map((emoji) => emoji.category))];
const composing = ref(false);
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
const searchableEmojis = emojis.map((emoji) => ({
  emoji,
  text: normalize(`${emoji.name} ${emoji.category}`),
}));
const filteredEmojis = computed(() => {
  const keywords = normalize(committedQuery.value).split(/\s+/).filter(Boolean);
  return searchableEmojis
    .filter(
      ({ emoji, text }) =>
        (!selectedCategory.value || emoji.category === selectedCategory.value) &&
        keywords.every((keyword) => text.includes(keyword))
    )
    .map(({ emoji }) => emoji);
});

function updateSearch(event: Event) {
  if (!composing.value && !(event as InputEvent).isComposing)
    committedQuery.value = (event.target as HTMLInputElement).value;
}
function endComposition(event: CompositionEvent) {
  composing.value = false;
  committedQuery.value = (event.target as HTMLInputElement).value;
}
function clearSearch() {
  query.value = '';
  committedQuery.value = '';
  searchInput.value?.focus();
}
watch(filteredEmojis, () => resultsElement.value?.scrollTo({ top: 0 }));
</script>

<style scoped lang="stylus">
.emoji-dialog
  display flex
  flex-direction column
  gap 12px
  color var(--color-text-primary)

  &__label
    font-size 13px
    font-weight 600

  &__search
    position relative

  &__input
    box-sizing border-box
    width 100%
    min-height 40px
    padding 8px 36px 8px 12px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    color var(--color-text-primary)
    background var(--color-bg-primary)
    font inherit
    font-size 14px
    &::-webkit-search-cancel-button
      display none
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px

  &__clear, &__category, &__emoji
    border 0
    border-radius 6px
    color inherit
    background transparent
    cursor pointer
    font inherit
    &:hover
      background var(--color-bg-translucent)
    &:active
      background var(--color-accent-tint)
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset -2px

  &__clear
    position absolute
    top 4px
    right 4px
    width 32px
    height 32px
    font-size 20px

  &__categories
    display flex
    flex-wrap wrap
    gap 4px

  &__category
    min-height 32px
    padding 5px 8px
    font-size 12px
    color var(--color-text-secondary)
    &[aria-pressed='true']
      color var(--color-accent)
      background var(--color-accent-tint)

  &__count, &__hint, &__credit
    margin 0
    font-size 12px
    color var(--color-text-secondary)

  &__results
    height min(320px, 40dvh)
    min-height 100px
    overflow-y auto
    scrollbar-gutter stable

  &__grid
    display grid
    grid-template-columns repeat(auto-fill, minmax(44px, 1fr))
    gap 4px
    padding 2px

  &__emoji
    display flex
    align-items center
    justify-content center
    min-height 44px
    padding 6px
    font-size 28px
    line-height 1

  &__empty
    margin 0
    padding 40px 12px
    text-align center
    font-size 14px
    color var(--color-text-secondary)

  &__credit a
    color var(--color-accent)
    text-decoration underline
    &:hover
      text-decoration-thickness 2px
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px
</style>
