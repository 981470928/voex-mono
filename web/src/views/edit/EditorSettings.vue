<template>
  <VoexTrigger
    v-model:popup-visible="open"
    trigger="click"
    position="right-start"
    strategy="fixed"
    :popup-offset="12"
    :content-style="{ padding: '0' }"
    role="dialog"
    aria-label="编辑设置"
    @show="focusPanel"
  >
    <button
      type="button"
      class="edit-page__icon-button"
      title="设置"
      aria-label="设置"
      aria-haspopup="dialog"
    >
      <SvgIcon name="setting" :size="20" />
    </button>
    <template #content="{ hide }">
      <section ref="panel" class="editor-settings" tabindex="-1">
        <header class="editor-settings__header">
          <h2>设置</h2>
          <button
            type="button"
            class="editor-settings__close"
            title="关闭设置"
            aria-label="关闭设置"
            @click="hide"
          >
            <SvgIcon name="close" :size="16" />
          </button>
        </header>
        <div class="editor-settings__options" :aria-busy="settings.loading || settings.saving">
          <button
            v-for="option in options"
            :key="option.key"
            type="button"
            role="switch"
            class="editor-settings__switch"
            :aria-checked="option.checked"
            :aria-describedby="settingsError ? errorId : statusId"
            :disabled="!settings.canChange"
            @click="setPreference(option.key, !option.checked, $event)"
          >
            <span>{{ option.label }}</span>
            <span class="editor-settings__track" aria-hidden="true" />
          </button>
        </div>
      </section>
    </template>
  </VoexTrigger>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { VoexTrigger } from '@/plugins/trigger';
import { useUserConfigStore, type EditorPreferenceKey } from '@/stores/user-config';

const settings = useUserConfigStore();
const open = ref(false);
const panel = ref<HTMLElement>();
const id = useId();
const statusId = id + '-settings-status';
const errorId = id + '-settings-error';
const options = computed(() => [
  { key: 'editorOutlineVisible' as const, label: '显示目录', checked: settings.showOutline },
  { key: 'editorMinimapVisible' as const, label: '显示小地图', checked: settings.showMinimap },
  {
    key: 'editorCodeMirrorEnabled' as const,
    label: '代码块增强编辑',
    checked: settings.codeMirrorEnabled,
  },
  {
    key: 'editorZenFullscreen' as const,
    label: 'Zen 模式自动全屏',
    checked: settings.zenFullscreen,
  },
]);
const settingsError = computed(() => settings.loadError || settings.saveError);

async function setPreference(key: EditorPreferenceKey, value: boolean, event: MouseEvent) {
  const control = event.currentTarget as HTMLButtonElement;
  const hadFocus = document.activeElement === control;
  await settings.setEditorPreference(key, value);
  await nextTick();
  if (
    hadFocus &&
    open.value &&
    control.isConnected &&
    !control.disabled &&
    document.activeElement === document.body
  ) {
    control.focus({ preventScroll: true });
  }
}

function focusPanel() {
  panel.value?.focus({ preventScroll: true });
  void settings.ensure();
}
</script>

<style scoped lang="stylus">
.editor-settings
  width 264px
  max-width calc(100vw - 88px)
  padding 12px 16px 14px
  outline none
  color var(--color-text-primary)
  font-size 13px

  &__header
    display flex
    align-items center
    justify-content space-between
    gap 12px

    h2
      margin 0
      font-size 13px
      font-weight 600

  &__options
    margin-top 10px

    // Pending saves lock every switch without pulsing the global disabled opacity.
    &[aria-busy='true'] .editor-settings__switch:disabled
      opacity 1

  &__switch
    display flex
    align-items center
    justify-content space-between
    gap 20px
    width 100%
    min-height 44px
    padding 8px 0
    border-radius 6px
    color var(--color-text-secondary)
    font inherit
    text-align left

    &[aria-checked='true'] .editor-settings__track
      background var(--color-accent)

      &::after
        transform translateX(16px)

  &__track
    position relative
    flex-shrink 0
    width 36px
    height 20px
    border-radius 20px
    background var(--color-border-secondary)
    transition background .15s

    &::after
      content ''
      position absolute
      top 3px
      left 3px
      width 14px
      height 14px
      border-radius 50%
      background var(--color-brand-text)
      transition transform .15s

  &__close, &__retry
    display inline-flex
    align-items center
    justify-content center
    min-height 32px
    padding 4px 8px
    border 0
    border-radius 6px
    background transparent
    color var(--color-text-secondary)
    font inherit
    cursor pointer

    &:hover:not(:disabled)
      background var(--color-bg-translucent)
      color var(--color-text-primary)

    &:active:not(:disabled)
      background var(--color-bg-quaternary)

    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px

    &:disabled
      opacity .5
      cursor not-allowed

  &__close
    width 32px
    padding 0

  &__error
    margin-top 4px
    color var(--color-red)
    font-size 12px
    line-height 1.6
    overflow-wrap anywhere

    p
      margin 0 0 4px

  @media (prefers-reduced-motion: reduce)
    &__track, &__track::after
      transition none
</style>
