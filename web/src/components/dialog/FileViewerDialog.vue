<template>
  <VoexModal
    class="file-viewer-dialog"
    :model-value="true"
    height="100%"
    width="100%"
    @close="emit('close')"
  >
    <FileViewer class="file-viewer-dialog__viewer" :file="file" :options="options" />
    <button
      type="button"
      class="file-viewer-dialog__close"
      aria-label="关闭预览"
      title="关闭预览（Esc）"
      autofocus
      @click="emit('close')"
    >
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M4 4L12 12M12 4L4 12"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </VoexModal>
</template>

<script setup lang="ts">
import { VoexModal } from '@/plugins/voex-modal';
import { FileViewer } from '@file-viewer/vue3';
import officePreset from '@file-viewer/preset-standard';
const options = {
  preset: officePreset,
  rendererMode: 'replace',
  theme: 'light',
  styleIsolation: 'shadow',
  ui: { surfaceBackground: 'transparent' },
  toolbar: { position: 'bottom-right' },
} as const;
defineProps<{ file: File }>();
const emit = defineEmits<{ close: [] }>();
</script>

<style lang="stylus">
.file-viewer-dialog
  .voex-modal-wrapper
    padding 0
    transform none

  .voex-modal
    background transparent
    border-radius 0
    box-shadow none

  .voex-modal__body
    position relative
    padding 0
    padding-top unquote('max(72px, calc(env(safe-area-inset-top) + 56px))')
    overflow hidden

  &__viewer
    width 100%
    height 100%
    min-width 0
    min-height 0

  &__close
    position absolute
    top unquote('max(16px, env(safe-area-inset-top))')
    right unquote('max(16px, env(safe-area-inset-right))')
    display flex
    align-items center
    justify-content center
    width 44px
    height 44px
    padding 0
    border 1px solid var(--color-border-primary)
    border-radius 50%
    background var(--color-bg-secondary)
    color var(--color-text-primary)
    cursor pointer

    &:hover
      background var(--color-bg-tertiary)

    &:active
      background var(--color-bg-primary)

    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px
</style>
