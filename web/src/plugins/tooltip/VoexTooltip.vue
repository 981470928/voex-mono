<template>
  <VoexTrigger
    ref="triggerRef"
    v-bind="$attrs"
    class="voex-tooltip"
    role="tooltip"
    trigger="hover"
    :popup-visible="popupVisible"
    :default-popup-visible="defaultPopupVisible"
    :position="position"
    :disabled="disabled"
    :show-arrow="showArrow"
    :popup-offset="popupOffset"
    :mouse-enter-delay="mouseEnterDelay"
    :mouse-leave-delay="mouseLeaveDelay"
    :focus-delay="focusDelay"
    :popup-container="popupContainer"
    :render-to-body="renderToBody"
    :popup-z-index="popupZIndex"
    :strategy="strategy"
    :style="tooltipStyle"
    content-class="voex-tooltip__content"
    arrow-class="voex-tooltip__arrow"
    hide-empty
    @update:popup-visible="emit('update:popupVisible', $event)"
    @popup-visible-change="emit('popupVisibleChange', $event)"
    @show="emit('show')"
    @hide="emit('hide')"
    @position-error="emit('positionError', $event)"
  >
    <template #default="slotProps">
      <slot v-bind="slotProps" />
    </template>
    <template #content="slotProps">
      <slot v-if="$slots.content" name="content" v-bind="slotProps" />
      <template v-else>{{ content }}</template>
    </template>
  </VoexTrigger>
</template>

<script setup lang="ts">
import { computed, ref, type CSSProperties } from 'vue';
import { VoexTrigger } from '../trigger';
import type { TooltipSlots, VoexTooltipProps } from './types';

defineOptions({ name: 'VoexTooltip', inheritAttrs: false });
const props = withDefaults(defineProps<VoexTooltipProps>(), {
  popupVisible: undefined,
  defaultPopupVisible: false,
  position: 'top',
  disabled: false,
  showArrow: true,
  popupOffset: 8,
  mouseEnterDelay: 100,
  mouseLeaveDelay: 100,
  focusDelay: 0,
  renderToBody: true,
  strategy: 'absolute',
  maxWidth: 320,
});
const emit = defineEmits<{
  'update:popupVisible': [visible: boolean];
  popupVisibleChange: [visible: boolean];
  show: [];
  hide: [];
  positionError: [error: unknown];
}>();
defineSlots<TooltipSlots>();
const triggerRef = ref<InstanceType<typeof VoexTrigger>>();
const tooltipStyle = computed<CSSProperties>(() => ({
  '--voex-tooltip-max-width':
    typeof props.maxWidth === 'number' ? `${props.maxWidth}px` : props.maxWidth,
}));
const visible = computed(() => triggerRef.value?.visible ?? false);

function show() {
  triggerRef.value?.show();
}
function hide() {
  triggerRef.value?.hide();
}
function update() {
  return triggerRef.value?.update();
}

defineExpose({ show, hide, update, visible });
</script>

<style lang="stylus">
.voex-tooltip.voex-trigger__popup
  max-width unquote('min(var(--voex-tooltip-max-width), calc(100vw - 16px), var(--voex-trigger-available-width, calc(100vw - 16px)))')

.voex-tooltip .voex-tooltip__content
  padding 6px 10px
  color var(--color-text-primary)
  background var(--color-bg-secondary)
  border-radius var(--border-radius-item-s, 6px)
  box-shadow var(--shadow-medium)
  font-family inherit
  font-size 12px
  font-weight 400
  line-height 1.5
  text-align start
  white-space pre-wrap
  overflow-wrap anywhere

.voex-tooltip .voex-tooltip__arrow
  background var(--color-bg-secondary)
</style>
