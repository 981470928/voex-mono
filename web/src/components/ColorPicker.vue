<template>
  <div class="color-picker" :class="{ 'color-picker--disabled': disabled }">
    <div class="color-picker__control">
      <label :for="inputId" class="color-picker__label">{{ label }}</label>
      <input
        :id="inputId"
        class="color-picker__input"
        type="color"
        :value="currentColor.toLowerCase()"
        :disabled="disabled"
        @input="previewColor"
        @change="commitColor(($event.target as HTMLInputElement).value)"
      />
      <output :for="inputId" class="color-picker__value">{{ currentColor }}</output>
    </div>
    <div class="color-picker__recent" role="group" :aria-labelledby="`${inputId}-recent`">
      <p :id="`${inputId}-recent`" class="color-picker__heading">最近使用</p>
      <div v-if="recentColors.length" class="color-picker__swatches">
        <button
          v-for="color in recentColors"
          :key="color"
          class="color-picker__swatch"
          type="button"
          :style="{ '--swatch-color': color }"
          :aria-label="`选择颜色 ${color}`"
          :aria-pressed="color === currentColor"
          :title="color"
          :disabled="disabled"
          @click="selectRecentColor(color, $event)"
        >
          <span v-if="color === currentColor" class="color-picker__check" aria-hidden="true"
            >✓</span
          >
        </button>
      </div>
      <p v-else class="color-picker__empty">选择颜色后显示在这里</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, useId } from 'vue';
import { normalizeColor, useRecentColors } from '@/composables/useRecentColors';

const props = withDefaults(defineProps<{ label?: string; disabled?: boolean }>(), {
  label: '颜色',
  disabled: false,
});
const model = defineModel<string>({ default: '#000000' });
const emit = defineEmits<{ change: [color: string] }>();
const inputId = useId();
const currentColor = computed(() => normalizeColor(model.value) ?? '#000000');
const { recentColors, addRecentColor } = useRecentColors();

function previewColor(event: Event) {
  if (props.disabled) return;
  const color = normalizeColor((event.target as HTMLInputElement).value);
  if (color) model.value = color;
}

function commitColor(value: string) {
  if (props.disabled) return;
  const color = normalizeColor(value);
  if (!color) return;
  model.value = color;
  addRecentColor(color);
  emit('change', color);
}

async function selectRecentColor(value: string, event: MouseEvent) {
  const button = event.currentTarget as HTMLButtonElement;
  commitColor(value);
  // Moving a recently used swatch to the front must preserve keyboard focus.
  await nextTick();
  button.focus({ preventScroll: true });
}
</script>

<style scoped lang="stylus">
.color-picker
  width 280px
  max-width 100%
  padding 12px
  border 1px solid var(--color-border-secondary)
  border-radius var(--border-radius-item-m)
  background var(--color-bg-secondary)
  color var(--color-text-primary)
  font-size 13px

.color-picker__control
  display flex
  align-items center
  flex-wrap wrap
  gap 8px

.color-picker__label
  margin-right auto
  color var(--color-text-secondary)

.color-picker__input
  flex-shrink 0
  width 40px
  height 32px
  padding 3px
  border 1px solid var(--color-border-secondary)
  border-radius var(--border-radius-item-s)
  background var(--color-bg-panel)
  cursor pointer

  &::-webkit-color-swatch-wrapper
    padding 0

  &::-webkit-color-swatch
    border none
    border-radius 3px

  &::-moz-color-swatch
    border none
    border-radius 3px

  &:hover:not(:disabled)
    border-color var(--color-accent-hover)

  &:active:not(:disabled)
    filter brightness(.94)

  &:disabled
    cursor not-allowed
    opacity .45

.color-picker__value
  font-variant-numeric tabular-nums

.color-picker__recent
  margin-top 12px

.color-picker__heading
  margin 0 0 8px
  color var(--color-text-secondary)
  font-size 12px

.color-picker__swatches
  display grid
  grid-template-columns repeat(auto-fill, minmax(28px, 1fr))
  gap 6px

.color-picker__swatch
  display flex
  align-items center
  justify-content center
  min-width 28px
  height 28px
  padding 3px
  border 1px solid var(--color-border-secondary)
  border-radius var(--border-radius-item-s)
  background var(--swatch-color)
  background-clip content-box
  cursor pointer

  &:hover:not(:disabled)
    border-color var(--color-accent-hover)

  &[aria-pressed='true']
    border-color var(--color-accent)

  &:active:not(:disabled)
    filter brightness(.94)

  &:disabled
    cursor not-allowed
    opacity .45

.color-picker__input,
.color-picker__swatch
  &:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset 2px

.color-picker__check
  display flex
  align-items center
  justify-content center
  width 16px
  height 16px
  border-radius 3px
  background var(--color-bg-primary)
  color var(--color-text-primary)
  font-size 12px
  line-height 1

.color-picker__empty
  margin 0
  color var(--color-text-tertiary)
  font-size 12px
  line-height 20px
</style>
