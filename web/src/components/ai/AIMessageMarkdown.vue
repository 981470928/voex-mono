<template>
  <div ref="root" class="ai-markdown" :class="{ 'ai-markdown--plain': plain }" />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { AIMessageRenderer } from './message-markdown';

const props = defineProps<{ content: string; renderer?: AIMessageRenderer }>();
const emit = defineEmits<{ rendered: [] }>();
const root = ref<HTMLElement>();
const plain = ref(true);

watch(
  [root, () => props.content, () => props.renderer],
  ([element, content, renderer]) => {
    if (!element) return;
    try {
      if (renderer) {
        element.replaceChildren(renderer.render(content));
        plain.value = false;
      } else {
        element.textContent = content;
        plain.value = true;
      }
    } catch {
      element.textContent = content;
      plain.value = true;
    }
    emit('rendered');
  },
  { immediate: true, flush: 'post' }
);
</script>

<style lang="stylus">
.ai-markdown
  min-width 0
  max-width 100%
  overflow-wrap anywhere
  white-space normal
  &--plain
    white-space pre-wrap
  p, blockquote, ul, ol, pre, .ai-markdown__table
    margin 0 0 8px
  > :last-child
    margin-bottom 0
  h1, h2, h3, h4, h5, h6
    margin 12px 0 6px
    font-size 1.1em
    font-weight 600
    line-height 1.5
  h1
    font-size 1.3em
  h2
    font-size 1.2em
  > :first-child
    margin-top 0
  ul, ol
    padding-left 1.6em
  li
    margin 3px 0
    > p:last-child
      margin-bottom 0
  &__task
    display flex
    gap 6px
    > div
      min-width 0
  blockquote
    padding-left 10px
    border-left 2px solid var(--color-border-secondary)
    color var(--color-text-secondary)
  code
    padding 1px 4px
    border-radius 4px
    background var(--color-bg-secondary)
    font-family Consolas, monospace
    font-size .95em
  pre
    max-width 100%
    box-sizing border-box
    overflow auto
    padding 10px
    border-radius 6px
    background var(--color-bg-secondary)
    white-space pre
    line-height 1.6
    code
      padding 0
      border-radius 0
      background transparent
  a
    color var(--color-accent)
    text-decoration underline
    text-underline-offset 2px
    cursor pointer
    &:hover
      color var(--color-accent-hover)
    &:active
      opacity .8
  a, pre, .ai-markdown__table
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px
  hr
    margin 10px 0
    border 0
    border-top 1px solid var(--color-border-secondary)
  &__table
    max-width 100%
    overflow-x auto
    table
      width 100%
      border-collapse collapse
      font-size inherit
    th, td
      min-width 64px
      padding 5px 8px
      border 1px solid var(--color-border-secondary)
      text-align left
      vertical-align top
    th
      background var(--color-bg-secondary)
      font-weight 600
</style>
