<template>
  <aside
    class="attachment-panel"
    :class="{ 'attachment-panel--drag-over': isDragging, 'attachment-panel--mobile': mobile }"
    @dragover.prevent="emit('update:isDragging', true)"
    @dragleave.prevent="emit('update:isDragging', false)"
    @drop.prevent="emit('drop', $event)"
  >
    <div v-if="!mobile" class="attachment-panel__header">
      <h2 class="attachment-panel__title">
        <SvgIcon name="attachment" size="18px" />
        附件
      </h2>
      <span v-if="attachments.length" class="attachment-panel__badge">
        {{ attachments.length }}
      </span>
      <button
        type="button"
        class="edit-page__icon-button"
        title="关闭附件"
        aria-label="关闭附件"
        @click="emit('close')"
      >
        <SvgIcon name="close" :size="18" />
      </button>
    </div>
    <div class="attachment-panel__list">
      <div v-if="!activeDocKey" class="attachment-panel__empty">请先选择文档</div>
      <div
        v-else-if="attachments.length === 0 && pendingUploads.length === 0"
        class="attachment-panel__empty attachment-panel__empty--drop-hint"
      >
        <SvgIcon name="cloud-upload" size="40px" class="attachment-panel__empty-icon" />
        <p>{{ canUpload ? '点击下方「添加附件」或拖放文件到此处' : '暂无附件' }}</p>
      </div>
      <div v-for="file in attachments" :key="file.hash" class="attachment-panel__item">
        <button
          class="attachment-panel__insert"
          type="button"
          :title="`插入附件 ${file.name}`"
          :disabled="!canUpload"
          @click.stop="emit('insert', file)"
        >
          <span class="attachment-panel__icon">
            <SvgIcon name="page" size="18px" />
          </span>
          <span class="attachment-panel__info">
            <span class="attachment-panel__name" :title="file.name">{{ file.name }}</span>
            <span class="attachment-panel__meta">{{ file.mime }}</span>
          </span>
        </button>
        <button
          class="attachment-panel__download"
          type="button"
          :title="`预览 ${file.name}`"
          @click.stop="emit('preview', file)"
        >
          <SvgIcon name="eye" size="16px" />
        </button>
        <button
          class="attachment-panel__download"
          type="button"
          :title="`下载 ${file.name}`"
          @click.stop="emit('download', file)"
        >
          <SvgIcon name="download" size="16px" />
        </button>
        <button
          class="attachment-panel__delete"
          type="button"
          :title="`删除 ${file.name}`"
          :disabled="!canUpload"
          @click.stop="emit('delete', file)"
        >
          <SvgIcon name="trash" size="16px" />
        </button>
      </div>
      <div
        v-for="item in pendingUploads"
        :key="item.name"
        class="attachment-panel__item attachment-panel__item--uploading"
      >
        <div class="attachment-panel__icon">
          <SvgIcon name="loading" class="attachment-panel__spinner" size="18px" />
        </div>
        <div class="attachment-panel__info">
          <span class="attachment-panel__name" :title="item.name">{{ item.name }}</span>
          <div class="attachment-panel__progress">
            <div
              class="attachment-panel__progress-bar"
              :style="{ width: item.progress + '%' }"
            ></div>
          </div>
          <span class="attachment-panel__meta">{{ item.progress }}%</span>
        </div>
      </div>
    </div>
    <footer class="attachment-panel__footer">
      <button
        type="button"
        class="attachment-panel__upload"
        :disabled="!canUpload || !activeDocKey"
        @click="emit('upload')"
      >
        <SvgIcon name="cloud-upload" :size="18" />
        添加附件
      </button>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import SvgIcon from '@/components/SvgIcon.vue';
import { computed } from 'vue';
import type { FileInfo } from '@/service/api/document-api';
import type { UploadItem } from '@/stores/upload';

const props = defineProps<{
  attachments: FileInfo[];
  uploadingFiles: UploadItem[];
  activeDocKey: string;
  isDragging: boolean;
  mobile?: boolean;
  canUpload?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  upload: [];
  download: [file: FileInfo];
  insert: [file: FileInfo];
  preview: [file: FileInfo];
  delete: [file: FileInfo];
  drop: [event: DragEvent];
  'update:isDragging': [value: boolean];
}>();

const pendingUploads = computed(() => {
  const names = new Set(props.attachments.map((f) => f.name));
  return props.uploadingFiles.filter((f) => !names.has(f.name));
});
</script>

<style scoped lang="stylus">
.attachment-panel
  display flex
  flex-direction column
  width 100%
  height 100%
  min-width 0
  min-height 0
  background transparent
  transition background .2s

  &--drag-over
    background var(--color-accent-tint)

  &--mobile
    width 100%
    height 100%
    min-width 0
    flex 1
    border 0

    .attachment-panel__download,
    .attachment-panel__delete
      width 40px
      height 40px

    .attachment-panel__insert
      min-height 40px

  &__footer
    flex-shrink 0
    padding 12px
    padding-bottom unquote('max(12px, env(safe-area-inset-bottom))')

  &__upload
    display inline-flex
    align-items center
    justify-content center
    gap 6px
    width 100%
    min-height 40px
    padding 8px 12px
    border 0
    border-radius 8px
    background var(--color-bg-secondary)
    color var(--color-text-primary)
    font-size 13px
    cursor pointer

    &:hover:not(:disabled)
      background var(--color-bg-tertiary)

    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px

    &:disabled
      opacity .45
      cursor not-allowed

  &__header
    display flex
    align-items center
    gap 8px
    min-height 56px
    padding 8px 14px
    flex-shrink 0

  &__title
    display flex
    align-items center
    gap 8px
    flex 1
    font-size 14px
    font-weight 600
    color var(--color-text-primary)
    margin 0

  &__badge
    display inline-flex
    align-items center
    justify-content center
    min-width 20px
    height 20px
    padding 0 6px
    border-radius 10px
    background var(--color-brand-bg)
    color var(--color-brand-text)
    font-size 11px
    font-weight 600

  &__list
    flex 1
    min-height 0
    overflow-y auto
    padding 8px

  &__empty
    padding 32px 16px
    text-align center
    font-size 13px
    color var(--color-text-tertiary)

    &--drop-hint
      display flex
      flex-direction column
      align-items center
      justify-content center
      padding 48px 16px

      p
        font-size 13px

  &__empty-icon
    color var(--color-fg-tertiary)

  &__item
    display flex
    align-items center
    gap 4px
    padding 4px
    border-radius 8px
    transition background .15s

    &:hover
      background var(--color-bg-translucent)

    &--uploading
      gap 10px
      padding 10px 12px
      cursor default
      opacity .85

  &__insert
    display flex
    align-items center
    gap 10px
    flex 1
    min-width 0
    padding 6px 8px
    border none
    border-radius 6px
    background transparent
    color inherit
    cursor pointer
    text-align left

    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset -2px

  &__icon
    display flex
    align-items center
    justify-content center
    width 36px
    height 36px
    border-radius 8px
    background var(--color-bg-translucent)
    flex-shrink 0
    color var(--color-fg-secondary)

  &__info
    flex 1
    min-width 0
    display flex
    flex-direction column
    gap 4px

  &__name
    font-size 13px
    font-weight 500
    color var(--color-text-primary)
    white-space nowrap
    overflow hidden
    text-overflow ellipsis

  &__meta
    font-size 11px
    color var(--color-text-tertiary)

  &__download
    display inline-flex
    align-items center
    justify-content center
    width 24px
    height 24px
    border none
    border-radius 6px
    background transparent
    cursor pointer
    transition all .15s
    flex-shrink 0
    color var(--color-fg-secondary)

    &:hover
      background var(--color-bg-translucent)

    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 1px

  &__delete
    display inline-flex
    align-items center
    justify-content center
    width 24px
    height 24px
    border none
    border-radius 6px
    background transparent
    cursor pointer
    transition all .15s
    flex-shrink 0
    color var(--color-fg-secondary)

    &:hover
      background var(--color-accent-tint)
      color var(--color-red)

    &:focus-visible
      outline 2px solid var(--color-red)
      outline-offset 1px

  &__progress
    width 100%
    height 4px
    background var(--color-border-translucent-strong)
    border-radius 2px
    overflow hidden

  &__progress-bar
    height 100%
    background var(--color-accent)
    border-radius 2px
    transition width .3s ease

  &__spinner
    animation attachment-panel-spin 1s linear infinite

@keyframes attachment-panel-spin
  from
    transform rotate(0deg)
  to
    transform rotate(360deg)
</style>
