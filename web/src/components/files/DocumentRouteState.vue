<template>
  <main class="document-route">
    <div class="document-route__content">
      <template v-if="error">
        <p class="document-route__title" role="alert">文件页面加载失败，请检查网络后重试。</p>
        <button type="button" class="document-route__retry" @click="reload">重新加载</button>
      </template>
      <template v-else>
        <p class="document-route__title">正在打开文件…</p>
        <LoadingSkeleton variant="document" label="正在加载文件页面" />
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { watchEffect } from 'vue';
import LoadingSkeleton from '@/components/LoadingSkeleton.vue';

const props = defineProps<{ error?: Error }>();
watchEffect(() => {
  document.title = props.error ? '文件页面加载失败 · Voex' : '正在打开文件 · Voex';
});
function reload() {
  window.location.reload();
}
</script>

<style scoped lang="stylus">
.document-route
  min-height 100dvh
  background var(--color-bg-primary)

.document-route__content
  --gutter: 52px
  width calc(100% - 128px)
  max-width 860px
  margin 0 auto

.document-route__title
  display flex
  align-items center
  min-height 56px
  margin 0
  padding 0 var(--gutter)
  color var(--color-text-primary)
  font-size 14px
  font-weight 600

.document-route :deep(.loading-skeleton--document)
  padding 81px var(--gutter) 0

.document-route__retry
  margin-left var(--gutter)
  padding 6px 12px
  border 1px solid var(--color-border-translucent-strong)
  border-radius var(--border-radius-item-s)
  background var(--color-bg-translucent)
  color var(--color-text-primary)
  &:hover
    background var(--color-bg-quaternary)
  &:focus-visible
    outline 2px solid var(--color-accent)

@media (max-width: 960px)
  .document-route__content
    --gutter: 24px

@media (max-width: 600px)
  .document-route__content
    --gutter: 16px
    width 100%
  .document-route :deep(.loading-skeleton--document)
    padding-top 20px
</style>
