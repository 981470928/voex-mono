<template>
  <ul
    :id="menuId"
    ref="menu"
    class="context-menu-list"
    :style="{ ...floatingStyle, visibility: isPositioned ? 'visible' : 'hidden' }"
    role="menu"
    :aria-label="label"
    tabindex="-1"
    @keydown="handleKeydown"
    @pointerleave="cancelHover"
    @scroll="closeChildren(false)"
  >
    <li
      v-for="(item, index) in items"
      :key="item.separator ? `separator-${index}` : item.value"
      :role="item.separator ? 'separator' : 'none'"
      :class="{ 'context-menu-list__separator': item.separator }"
    >
      <button
        v-if="!item.separator"
        :ref="(element) => setButton(index, element)"
        class="context-menu-list__item"
        :class="{
          'context-menu-list__item--danger': item.danger,
          'context-menu-list__item--expanded': expandedIndex === index,
        }"
        type="button"
        role="menuitem"
        tabindex="-1"
        :disabled="item.disabled"
        :aria-disabled="item.disabled || undefined"
        :aria-haspopup="item.children?.length ? 'menu' : undefined"
        :aria-expanded="item.children?.length ? expandedIndex === index : undefined"
        :aria-controls="expandedIndex === index ? `${menuId}-submenu` : undefined"
        :aria-describedby="item.description ? `${menuId}-description-${index}` : undefined"
        @pointerenter="hover(index)"
        @focus="handleFocus(index)"
        @click="activate(index)"
      >
        <span class="context-menu-list__icon" aria-hidden="true">
          <SvgIcon v-if="item.icon" :name="item.icon" :size="16" />
        </span>
        <span class="context-menu-list__content">
          <span class="context-menu-list__label">{{ item.label }}</span>
          <span
            v-if="item.description"
            :id="`${menuId}-description-${index}`"
            class="context-menu-list__description"
            >{{ item.description }}</span
          >
        </span>
        <SvgIcon v-if="item.children?.length" name="chevron-right" :size="12" />
      </button>
    </li>
  </ul>
  <ContextMenuList
    v-if="expandedItem?.children?.length"
    :id="`${menuId}-submenu`"
    :key="expandedItem.value"
    ref="submenu"
    :items="expandedItem.children"
    :anchor="buttons.get(expandedIndex!)"
    :label="expandedItem.label"
    :direction="submenuDirection"
    @select="emit('select', $event)"
    @back="closeChildren(true)"
  />
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
  type ComponentPublicInstance,
} from 'vue';
import { flip, shift, size } from '@floating-ui/dom';
import { useFloating } from '@/composables/useFloating';
import SvgIcon from '@/components/SvgIcon.vue';
import type { ContextMenuItem, ContextMenuOption } from './types';

const props = withDefaults(
  defineProps<{
    items: ContextMenuItem[];
    label: string;
    x?: number;
    y?: number;
    anchor?: HTMLElement;
    autofocus?: boolean;
    id?: string;
    direction?: 'left' | 'right';
  }>(),
  { x: 0, y: 0, anchor: undefined, autofocus: false, id: undefined, direction: 'right' }
);
const emit = defineEmits<{
  select: [item: ContextMenuOption];
  back: [];
}>();
const generatedId = useId();
const menuId = computed(() => props.id ?? `context-menu-${generatedId}`);
const menu = ref<HTMLElement>();
const submenu = ref<{ focusFirst: () => void }>();
const buttons = new Map<number, HTMLButtonElement>();
const activeIndex = ref(-1);
const expandedIndex = ref<number | null>(null);
const submenuDirection = ref(props.direction);
let focusRequested = false;
const floating = useFloating({
  onUpdate({ placement }) {
    submenuDirection.value =
      placement.startsWith('left') || (!props.anchor && placement.endsWith('end'))
        ? 'left'
        : 'right';
  },
});
const { floatingStyle, isPositioned } = floating;
const expandedItem = computed(() => {
  const item = expandedIndex.value === null ? undefined : props.items[expandedIndex.value];
  return item && !item.separator && !item.disabled ? item : undefined;
});
const enabledIndices = computed(() =>
  props.items.flatMap((item, index) => (!item.separator && !item.disabled ? [index] : []))
);
let hoverTimer: ReturnType<typeof setTimeout> | undefined;

function setButton(index: number, element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLButtonElement) buttons.set(index, element);
  else buttons.delete(index);
}

function syncPosition() {
  if (!menu.value) return;
  floating.virtualElement.getBoundingClientRect = floating.generateGetBoundingClientRect(
    props.x,
    props.y
  );
  floating.init(props.anchor ?? floating.virtualElement, menu.value, {
    strategy: 'fixed',
    placement: props.anchor ? `${props.direction}-start` : 'bottom-start',
    middleware: [
      flip({
        padding: 8,
        fallbackPlacements: props.anchor
          ? [props.direction === 'left' ? 'right-start' : 'left-start']
          : ['top-start', 'bottom-end', 'top-end'],
      }),
      shift({ padding: 8, crossAxis: true }),
      size({
        padding: 8,
        apply({ availableWidth, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxWidth: `${Math.max(0, availableWidth)}px`,
            maxHeight: `${Math.max(0, availableHeight)}px`,
          });
        },
      }),
    ],
  });
  floating.show();
}

watch([() => props.x, () => props.y, () => props.anchor, () => props.direction], syncPosition, {
  flush: 'post',
});

function cancelHover() {
  clearTimeout(hoverTimer);
  hoverTimer = undefined;
}

watch(
  isPositioned,
  (positioned) => {
    if (positioned && focusRequested) focusFirst();
  },
  { flush: 'post' }
);

function focusFirst() {
  focusRequested = true;
  if (!menu.value?.isConnected || !isPositioned.value) return;
  focusRequested = false;
  const first = enabledIndices.value[0];
  if (first === undefined) menu.value?.focus({ preventScroll: true });
  else focusItem(first);
}

function focusItem(index: number) {
  cancelHover();
  buttons.get(index)?.focus({ preventScroll: true });
  buttons.get(index)?.scrollIntoView({ block: 'nearest' });
}

function handleFocus(index: number) {
  activeIndex.value = index;
  if (expandedIndex.value !== index) closeChildren(false);
}

function closeChildren(restore: boolean) {
  cancelHover();
  const index = expandedIndex.value;
  const focusedMenu = document.activeElement?.closest('[role="menu"]');
  const focusInChildren = focusedMenu?.id.startsWith(`${menuId.value}-submenu`);
  expandedIndex.value = null;
  if ((restore || focusInChildren) && index !== null) focusItem(index);
}

function hover(index: number) {
  cancelHover();
  const item = props.items[index];
  if (item && !item.separator && !item.disabled) buttons.get(index)?.focus({ preventScroll: true });
  else menu.value?.focus({ preventScroll: true });
  hoverTimer = setTimeout(() => {
    const item = props.items[index];
    expandedIndex.value =
      item && !item.separator && !item.disabled && item.children?.length ? index : null;
  }, 100);
}

async function openChildren(index: number) {
  cancelHover();
  expandedIndex.value = index;
  await nextTick();
  submenu.value?.focusFirst();
}

function activate(index: number) {
  const item = props.items[index];
  if (!item || item.separator || item.disabled) return;
  cancelHover();
  if (item.children?.length) void openChildren(index);
  else emit('select', item);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  const indices = enabledIndices.value;
  const current = indices.indexOf(activeIndex.value);
  let next: number | undefined;
  if (event.key === 'ArrowDown') next = indices[(current + 1) % indices.length];
  else if (event.key === 'ArrowUp') next = indices[(current - 1 + indices.length) % indices.length];
  else if (event.key === 'Home') next = indices[0];
  else if (event.key === 'End') next = indices.at(-1);
  else if (event.key === 'ArrowRight') {
    const item = props.items[activeIndex.value];
    if (item && !item.separator && !item.disabled && item.children?.length) {
      void openChildren(activeIndex.value);
    }
  } else if ((event.key === 'ArrowLeft' || event.key === 'Escape') && props.anchor) {
    emit('back');
  } else {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (next !== undefined) focusItem(next);
}

onMounted(() => {
  syncPosition();
  if (props.autofocus) focusFirst();
});
onBeforeUnmount(() => {
  cancelHover();
});
defineExpose({ focusFirst });
</script>

<style scoped lang="stylus">
.context-menu-list
  box-sizing border-box
  position fixed
  width 224px
  padding 4px
  margin 0
  overflow-y auto
  overscroll-behavior contain
  border 1px solid var(--color-border-secondary)
  border-radius var(--border-radius-item-m)
  background var(--color-bg-secondary)
  color var(--color-text-secondary)
  box-shadow var(--shadow-medium)
  font-size 13px
  line-height 20px
  list-style none
  pointer-events auto

.context-menu-list__item
  display flex
  align-items center
  gap 8px
  width 100%
  min-height 34px
  padding 7px 8px
  border-radius var(--border-radius-item-s)
  color inherit
  text-align left
  cursor pointer

  &:hover:not(:disabled),
  &:focus-visible,
  &--expanded
    background var(--color-bg-quaternary)
    color var(--color-text-primary)

  &:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset -2px

  &:active:not(:disabled)
    background var(--color-bg-translucent)

  &--danger:not(:disabled)
    color var(--color-red)

  &:disabled
    color var(--color-text-tertiary)
    cursor not-allowed
    opacity .65

.context-menu-list__icon
  display flex
  flex-shrink 0
  align-items center
  justify-content center
  width 16px

.context-menu-list__content
  display flex
  flex 1
  flex-direction column
  min-width 0
  overflow-wrap anywhere

.context-menu-list__description
  color var(--color-text-tertiary)
  font-size 11px
  line-height 16px

.context-menu-list__separator
  height 1px
  margin 4px 0
  background var(--color-border-primary)
</style>
