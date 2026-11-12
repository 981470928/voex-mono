<template>
  <VoexTrigger
    :popup-visible="open"
    trigger="click"
    position="bottom-start"
    strategy="fixed"
    :popup-offset="6"
    :disabled="disabled"
    @update:popup-visible="emit('update:open', $event)"
    @show="focusSelected"
  >
    <button
      type="button"
      class="editor-font-picker__trigger"
      data-format="fontFamily"
      aria-label="字体"
      aria-haspopup="listbox"
      :title="currentLabel"
      :disabled="disabled"
      @mousedown.prevent
      @keydown.down.prevent="emit('update:open', true)"
      @keydown.up.prevent="emit('update:open', true)"
    >
      <span class="editor-font-picker__current">{{ currentLabel }}</span>
      <SvgIcon name="chevron-right" :size="10" class="editor-font-picker__chevron" />
    </button>
    <template #content>
      <div
        ref="list"
        class="editor-font-picker__list"
        role="listbox"
        aria-label="字体列表"
        :aria-busy="loading"
        @keydown="navigate"
      >
        <button
          type="button"
          class="editor-font-picker__option"
          role="option"
          :aria-selected="value === null"
          :aria-disabled="loading"
          :tabindex="value === null || value === 'mixed' ? 0 : -1"
          @click="choose(null)"
        >
          <span class="editor-font-picker__check" aria-hidden="true">{{
            value === null ? '✓' : ''
          }}</span>
          <span class="editor-font-picker__default">默认字体</span>
        </button>
        <div v-for="group in FONT_GROUPS" :key="group" role="group" :aria-label="group">
          <div class="editor-font-picker__group" aria-hidden="true">{{ group }}</div>
          <button
            v-for="font in FONT_FAMILIES.filter((entry) => entry.group === group)"
            :key="font.id"
            type="button"
            class="editor-font-picker__option"
            role="option"
            :aria-label="font.label"
            :aria-selected="value === font.id"
            :aria-disabled="loading"
            :tabindex="value === font.id ? 0 : -1"
            :title="font.label"
            @click="choose(font.id)"
          >
            <span class="editor-font-picker__check" aria-hidden="true">{{
              value === font.id ? '✓' : ''
            }}</span>
            <span
              class="editor-font-picker__preview"
              aria-hidden="true"
              :style="{ maskImage: `url('${fontAssetUrl(font.id, 'preview.svg')}')` }"
            />
            <span class="editor-font-picker__languages" aria-hidden="true">{{
              font.languages
            }}</span>
          </button>
        </div>
      </div>
      <div v-if="loading" class="editor-font-picker__status" role="status">正在加载字体…</div>
    </template>
  </VoexTrigger>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { VoexTrigger } from '@/plugins/trigger';
import { FONT_FAMILIES, FONT_GROUPS } from '@voex/editor-schema/font-catalog';
import { fontAssetUrl } from '@/utils/editor-fonts';

const props = defineProps<{
  value: string | null;
  open: boolean;
  disabled: boolean;
  loading: boolean;
}>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  select: [id: string | null];
}>();
const list = ref<HTMLElement>();
const currentLabel = computed(() =>
  props.value === 'mixed'
    ? '混合字体'
    : (FONT_FAMILIES.find((font) => font.id === props.value)?.label ?? '默认字体')
);

function choose(id: string | null) {
  if (!props.loading) emit('select', id);
}

function focusSelected() {
  list.value
    ?.querySelector<HTMLElement>('[role="option"][tabindex="0"]')
    ?.focus({ preventScroll: true });
}

function navigate(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Tab') {
    emit('update:open', false);
    return;
  }
  const options = [...(list.value?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
  const current = options.indexOf(event.target as HTMLElement);
  let next = current;
  if (event.key === 'ArrowDown') next = (current + 1) % options.length;
  else if (event.key === 'ArrowUp') next = (current - 1 + options.length) % options.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = options.length - 1;
  else return;
  event.preventDefault();
  options.forEach((option, index) => {
    option.tabIndex = index === next ? 0 : -1;
  });
  options[next]?.focus({ preventScroll: true });
  options[next]?.scrollIntoView({ block: 'nearest' });
}
</script>

<style lang="stylus" scoped>
.editor-font-picker
  &__trigger
    display inline-flex
    align-items center
    justify-content space-between
    flex-shrink 0
    gap 6px
    width 112px
    height 32px
    padding 0 8px
    border 1px solid var(--color-border-primary)
    border-radius 6px
    background transparent
    color var(--color-text-primary)
    font-family inherit
    font-size 13px
    cursor pointer

    &:hover:not(:disabled)
      background var(--color-bg-translucent)
    &:active:not(:disabled)
      background var(--color-accent-tint)
    &:disabled
      opacity .4
      cursor not-allowed

  &__current
    overflow hidden
    text-overflow ellipsis
    white-space nowrap

  &__chevron
    flex-shrink 0
    transform rotate(90deg)


  &__list
    width 268px
    max-width calc(100vw - 16px)
    max-height unquote('min(430px, var(--voex-trigger-available-height, 70vh))')
    padding 5px
    overflow-y auto
    overscroll-behavior contain
    color var(--color-text-primary)

  &__group
    padding 8px 12px 3px 28px
    color var(--color-text-tertiary)
    font-size 11px
    line-height 18px

  &__option
    display flex
    align-items center
    gap 6px
    width 100%
    min-height 36px
    padding 2px 8px
    border 0
    border-radius 6px
    background transparent
    color inherit
    text-align left
    cursor pointer

    &:hover, &:focus-visible
      background var(--color-bg-translucent)
    &:active, &[aria-selected='true']
      background var(--color-accent-tint)
    &[aria-disabled='true']
      cursor wait

  &__check
    flex 0 0 14px
    font-size 13px

  &__default
    flex 1
    line-height 28px
    font-family inherit
    font-size 14px

  &__preview
    display block
    flex 1
    width 184px
    height 28px
    background currentColor
    mask-repeat no-repeat
    mask-position left center
    mask-size auto 28px

  &__languages
    flex-shrink 0
    color var(--color-text-tertiary)
    font-size 10px

  &__status
    position absolute
    right 6px
    bottom 6px
    left 6px
    padding 6px 10px
    border-radius 6px
    background var(--color-bg-secondary)
    color var(--color-text-secondary)
    font-size 12px
    pointer-events none
</style>
