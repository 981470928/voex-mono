<template>
  <aside class="editor-outline" aria-label="文档目录">
    <h2 class="editor-outline__title">目录</h2>
    <nav
      v-if="displayItems.length"
      class="editor-outline__nav"
      aria-label="文档标题"
      :aria-busy="navigating"
    >
      <ul class="editor-outline__list">
        <li v-for="item in displayItems" :key="item.key" class="editor-outline__item">
          <div
            class="editor-outline__link"
            :class="{ 'editor-outline__link--active': item.key === activeKey }"
            :style="{ paddingLeft: `${12 + item.depth * 14}px` }"
            :title="item.text"
            :aria-current="item.key === activeKey ? 'location' : undefined"
            @click="$emit('select', item)"
          >
            {{ item.text }}
          </div>
        </li>
      </ul>
    </nav>
    <p v-else class="editor-outline__empty">暂无标题</p>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { EditorOutlineItem } from '@/views/edit/milkdown/editor-outline';

const props = defineProps<{
  items: EditorOutlineItem[];
  activeKey: string;
  navigating?: boolean;
}>();

defineEmits<{
  select: [item: EditorOutlineItem];
}>();

const displayItems = computed(() => {
  const minimumLevel = Math.min(...props.items.map((item) => item.level));
  return props.items.map((item) => ({
    ...item,
    depth: Math.min(4, Math.max(0, item.level - minimumLevel)),
  }));
});
</script>

<style scoped lang="stylus">
.editor-outline
  position sticky
  top 8px
  align-self start
  box-sizing border-box
  display flex
  flex-direction column
  width 176px
  max-height calc(100dvh - 32px)
  padding 8px 0
  color var(--color-text-secondary)

  &__title
    margin 0
    padding 0 8px 8px
    color var(--color-text-tertiary)
    font-size 12px
    font-weight 600
    line-height 1.4

  &__nav
    min-height 0
    overflow-y auto
    scrollbar-width thin

  &__list
    margin 0
    padding 0
    list-style none

  &__item
    min-width 0

  &__link
    position relative
    width 100%
    padding 6px 8px
    border-radius 6px
    color var(--color-text-secondary)
    font-size 12px
    line-height 1.5
    text-align left
    overflow-wrap anywhere
    cursor pointer
    transition background .15s, color .15s
    &:hover
      background var(--color-bg-translucent)

    &--active
      background var(--color-accent-tint)!important
      color var(--color-accent)

  &__empty
    margin 0
    padding 6px 8px
    color var(--color-text-tertiary)
    font-size 12px

@media (max-width: 768px)
  .editor-outline
    display none

@media (prefers-reduced-motion: reduce)
  .editor-outline__link
    transition none
</style>
