<template>
  <Teleport to="body">
    <div
      v-if="modelValue && items.length"
      ref="root"
      class="voex-context-menu"
      @contextmenu.prevent
      @keydown="handleKeydown"
    >
      <ContextMenuList
        :key="session"
        :items="items"
        :x="x"
        :y="y"
        :label="label"
        autofocus
        @select="select"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import ContextMenuList from './ContextMenuList.vue';
import type { ContextMenuItem, ContextMenuOption } from './types';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    items: ContextMenuItem[];
    x: number;
    y: number;
    trigger?: HTMLElement | null;
    label?: string;
  }>(),
  { trigger: null, label: '操作菜单' }
);
const emit = defineEmits<{
  'update:modelValue': [visible: boolean];
  select: [item: ContextMenuOption];
}>();
const root = ref<HTMLElement>();
const session = ref(0);
let previousFocus: HTMLElement | null = null;
let closing = false;

function restoreFocus() {
  if (
    previousFocus?.isConnected &&
    previousFocus.getClientRects().length &&
    !previousFocus.matches(':disabled') &&
    !previousFocus.closest('[inert]')
  ) {
    previousFocus.focus({ preventScroll: true });
  }
}

function close(restore = true) {
  if (!props.modelValue || closing) return;
  closing = true;
  // Restore before selecting so a newly opened dialog remembers the original item.
  if (restore) restoreFocus();
  emit('update:modelValue', false);
}

function select(item: ContextMenuOption) {
  if (closing || item.disabled || item.children?.length) return;
  close();
  emit('select', item);
}

function isInside(event: Event) {
  return event.target instanceof Node && root.value?.contains(event.target);
}

function isTrigger(event: Event) {
  return event.target instanceof Node && props.trigger?.contains(event.target);
}

function handlePointerdown(event: PointerEvent) {
  if (!isInside(event) && !isTrigger(event)) close(false);
}

function handleFocus(event: FocusEvent) {
  if (!isInside(event) && !isTrigger(event)) close(false);
}

function handleScroll(event: Event) {
  if (!isInside(event)) close();
}

function handleResize() {
  close();
}

function handleBlur() {
  close(false);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
  } else if (event.key === 'Tab') {
    // Let the browser continue from the trigger in its normal Tab order.
    close();
  }
}

watch(
  [() => props.modelValue, () => props.x, () => props.y, () => props.trigger, () => props.items],
  ([visible], _previous, onCleanup) => {
    if (!visible) return;
    closing = false;
    previousFocus =
      props.trigger ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    session.value++;
    document.addEventListener('pointerdown', handlePointerdown, true);
    document.addEventListener('focusin', handleFocus);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('wheel', handleScroll, { capture: true, passive: true });
    window.addEventListener('resize', handleResize);
    window.addEventListener('blur', handleBlur);
    window.visualViewport?.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('scroll', handleResize);
    onCleanup(() => {
      document.removeEventListener('pointerdown', handlePointerdown, true);
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('wheel', handleScroll, true);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('blur', handleBlur);
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('scroll', handleResize);
      if (root.value?.contains(document.activeElement)) restoreFocus();
    });
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (root.value?.contains(document.activeElement)) restoreFocus();
});
</script>

<style scoped lang="stylus">
.voex-context-menu
  --context-menu-layer 200
  position fixed
  z-index var(--context-menu-layer)
  inset 0
  pointer-events none
</style>
