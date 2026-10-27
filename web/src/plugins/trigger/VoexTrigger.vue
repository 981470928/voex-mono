<template>
  <TriggerReference />
  <Teleport v-if="mounted" :to="teleportTarget" :disabled="!renderToBody">
    <Transition
      :name="animationName"
      :duration="duration"
      appear
      @before-enter="handleBeforeEnter"
      @before-leave="handleBeforeLeave"
      @after-enter="handleShow"
      @after-leave="handleHide"
    >
      <div
        v-if="!unmountOnClose || visible"
        v-show="visible"
        :id="popupId"
        ref="popupRef"
        v-bind="popupAttrs"
        class="voex-trigger__popup"
        :style="popupStyles"
        :data-placement="placement"
        :trigger-placement="toTriggerPosition(placement)"
        :aria-hidden="!visible"
        :inert="!visible"
        @pointerenter="handlePopupEnter"
        @pointerleave="handlePopupLeave"
        @focusin="handlePopupFocus"
        @focusout="handleFocusOut"
        @keydown="handleKeydown"
        @mousedown="handlePopupMouseDown"
      >
        <div class="voex-trigger__wrapper" :class="wrapClass" :style="transformStyle">
          <div class="voex-trigger__content" :class="contentClass" :style="contentStyle">
            <slot name="content" v-bind="slotProps" />
          </div>
          <div
            v-if="showArrow"
            ref="arrowRef"
            class="voex-trigger__arrow"
            :class="arrowClass"
            :style="arrowStyles"
            aria-hidden="true"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { arrow, flip, offset, shift, size, type Middleware } from '@floating-ui/dom';
import {
  Comment,
  Text,
  cloneVNode,
  computed,
  defineComponent,
  inject,
  mergeProps,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  provide,
  ref,
  shallowRef,
  useAttrs,
  useId,
  watch,
  watchEffect,
  type CSSProperties,
  type Ref,
  type VNode,
} from 'vue';
import { useFloating, type UseFloatingOptions } from '@/composables/useFloating';
import { triggerContextKey } from './context';
import { flattenChildren, hasContent, toPlacement, toTriggerPosition } from './utils';
import type { TriggerSlots, VoexTriggerProps } from './types';

defineOptions({ name: 'VoexTrigger', inheritAttrs: false });
const props = withDefaults(defineProps<VoexTriggerProps>(), {
  popupVisible: undefined,
  defaultPopupVisible: false,
  trigger: 'hover',
  fallbackTrigger: 'click',
  position: 'bottom',
  strategy: 'absolute',
  disabled: false,
  popupOffset: 0,
  showArrow: false,
  alignPoint: false,
  popupHoverStay: true,
  blurToClose: true,
  clickToClose: true,
  clickOutsideToClose: true,
  escapeToClose: true,
  unmountOnClose: true,
  animationName: 'voex-trigger-fade',
  mouseEnterDelay: 100,
  mouseLeaveDelay: 100,
  focusDelay: 0,
  autoFitPopupWidth: false,
  autoFitPopupMinWidth: false,
  autoFixPosition: true,
  updateAtScroll: true,
  autoFitTransformOrigin: false,
  hideEmpty: false,
  autoFitPosition: true,
  renderToBody: true,
  preventFocus: false,
});
const emit = defineEmits<{
  'update:popupVisible': [visible: boolean];
  popupVisibleChange: [visible: boolean];
  show: [];
  hide: [];
  resize: [];
  positionError: [error: unknown];
}>();
const slots = defineSlots<TriggerSlots>();
const attrs = useAttrs();
const generatedId = `voex-trigger-${useId()}`;
const popupId = computed(() => (typeof attrs.id === 'string' ? attrs.id : generatedId));
const mounted = ref(false);
const active = ref(true);
const internalVisible = ref(props.defaultPopupVisible);
const contentEmpty = ref(false);
const referenceRef = shallowRef<HTMLElement>();
const popupRef = shallowRef<HTMLElement>();
const arrowRef = shallowRef<HTMLElement>();
const parent = inject(triggerContextKey, undefined);
const descendants = new Set<Ref<HTMLElement | undefined>>();
const depth = (parent?.depth ?? -1) + 1;
const requestedVisible = computed(() => props.popupVisible ?? internalVisible.value);
const visible = computed(
  () => active.value && !props.disabled && !contentEmpty.value && requestedVisible.value
);
const methods = computed(() => (Array.isArray(props.trigger) ? props.trigger : [props.trigger]));
const onlyHover = computed(() => methods.value.length === 1 && methods.value[0] === 'hover');
const supportsFocus = computed(() => methods.value.includes('focus') || onlyHover.value);
let timer: ReturnType<typeof setTimeout> | undefined;
let pointerType: string | undefined;
let visibleOnPointerDown: boolean | undefined;
let restoringFocus = false;
let hasPoint = false;
let referenceSize: string | undefined;

const floating = useFloating({ onError: (error) => emit('positionError', error) });
const placement = computed(() => floating.position.value?.placement ?? toPlacement(props.position));
const slotProps = computed(() => ({ visible: visible.value, show, hide, update: floating.update }));

function clearTimer() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function changeVisible(value: boolean, delay = 0) {
  clearTimer();
  if ((value && (props.disabled || !active.value)) || value === requestedVisible.value) return;
  const commit = () => {
    timer = undefined;
    if ((value && (props.disabled || !active.value)) || value === requestedVisible.value) return;
    internalVisible.value = value;
    emit('update:popupVisible', value);
    emit('popupVisibleChange', value);
  };
  if (delay > 0) timer = setTimeout(commit, delay);
  else commit();
}

function show() {
  changeVisible(true);
}
function hide() {
  changeVisible(false);
}

function isInside(target: EventTarget | null, path: EventTarget[] = []) {
  const contains = (element?: HTMLElement) =>
    !!element && (path.includes(element) || (target instanceof Node && element.contains(target)));
  return (
    contains(referenceRef.value) ||
    contains(popupRef.value) ||
    [...descendants].some((element) => contains(element.value))
  );
}

function restoreFocus() {
  const element = referenceRef.value;
  if (!element?.isConnected || element.matches(':disabled') || element.closest('[inert]')) return;
  restoringFocus = true;
  element.focus({ preventScroll: true });
  queueMicrotask(() => {
    restoringFocus = false;
  });
}

function updatePoint(event: MouseEvent) {
  if (!props.alignPoint) return;
  hasPoint = true;
  floating.virtualElement.getBoundingClientRect = floating.generateGetBoundingClientRect(
    event.clientX,
    event.clientY
  );
  if (visible.value) void floating.update();
}

function handlePointerDown(event: PointerEvent) {
  if (!event.isPrimary) return;
  pointerType = event.pointerType;
  visibleOnPointerDown = requestedVisible.value;
}

function handlePointerCancel() {
  pointerType = undefined;
  visibleOnPointerDown = undefined;
}

function handleClick(event: PointerEvent) {
  const input = event.pointerType || pointerType;
  const wasVisible = visibleOnPointerDown ?? requestedVisible.value;
  handlePointerCancel();
  if (props.disabled || event.defaultPrevented) return;
  const fallback =
    onlyHover.value &&
    props.fallbackTrigger === 'click' &&
    (input ? input !== 'mouse' : event.detail === 0);
  if (methods.value.includes('click') || fallback) {
    updatePoint(event);
    if (!wasVisible || props.clickToClose) changeVisible(!wasVisible);
  } else if (methods.value.includes('contextMenu') && props.clickToClose) hide();
}

function handlePointerEnter(event: PointerEvent) {
  if (event.pointerType !== 'mouse' || props.disabled || !methods.value.includes('hover')) return;
  updatePoint(event);
  changeVisible(true, props.mouseEnterDelay);
}

function handlePointerLeave(event: PointerEvent) {
  if (event.pointerType !== 'mouse' || !methods.value.includes('hover')) return;
  if (props.popupHoverStay && isInside(event.relatedTarget)) clearTimer();
  else changeVisible(false, props.mouseLeaveDelay);
}

function keepOpen() {
  parent?.enter();
  if (props.popupHoverStay && methods.value.includes('hover')) {
    changeVisible(true, props.mouseEnterDelay);
  }
}

function scheduleClose() {
  parent?.leave();
  if (props.popupHoverStay && methods.value.includes('hover')) {
    changeVisible(false, props.mouseLeaveDelay);
  }
}

function handlePopupEnter(event: PointerEvent) {
  if (event.pointerType === 'mouse') keepOpen();
}

function handlePopupLeave(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return;
  if (isInside(event.relatedTarget)) clearTimer();
  else scheduleClose();
}

function handleFocusIn() {
  if (restoringFocus || props.disabled || !supportsFocus.value) return;
  // Hover-only triggers also work with keyboard focus, without toggling on touch focus.
  if (onlyHover.value && !referenceRef.value?.matches(':focus-visible')) return;
  changeVisible(true, props.focusDelay);
}

function handlePopupFocus() {
  if (props.popupHoverStay) clearTimer();
}

function handleFocusOut(event: FocusEvent) {
  if (!props.blurToClose || !supportsFocus.value || isInside(event.relatedTarget)) return;
  queueMicrotask(() => {
    if (!isInside(referenceRef.value?.ownerDocument.activeElement ?? null)) hide();
  });
}

function handleContextmenu(event: MouseEvent) {
  if (props.disabled || event.defaultPrevented || !methods.value.includes('contextMenu')) return;
  event.preventDefault();
  updatePoint(event);
  // A second contextmenu relocates an open menu rather than closing it.
  show();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.defaultPrevented) return;
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    if (props.disabled || !methods.value.includes('contextMenu')) return;
    event.preventDefault();
    const rect = referenceRef.value?.getBoundingClientRect();
    if (props.alignPoint && rect) {
      hasPoint = true;
      floating.virtualElement.getBoundingClientRect = floating.generateGetBoundingClientRect(
        rect.left,
        rect.bottom
      );
    }
    show();
    if (visible.value) void floating.update();
    return;
  }
  if (event.key !== 'Escape' || !visible.value || !props.escapeToClose) return;
  // Document listeners run parent-first; let the deepest open popup consume Escape.
  if ([...descendants].some(({ value }) => value && !value.inert && value.getClientRects().length))
    return;
  event.preventDefault();
  event.stopPropagation();
  hide();
}

function handlePopupMouseDown(event: MouseEvent) {
  if (props.preventFocus) event.preventDefault();
}

function register(element: Ref<HTMLElement | undefined>) {
  descendants.add(element);
  parent?.register(element);
}
function unregister(element: Ref<HTMLElement | undefined>) {
  descendants.delete(element);
  parent?.unregister(element);
}
provide(triggerContextKey, { register, unregister, enter: keepOpen, leave: scheduleClose, depth });
parent?.register(popupRef);

const triggerEventNames = new Set([
  'onClick',
  'onMouseenter',
  'onMouseleave',
  'onPointerenter',
  'onPointerleave',
  'onPointermove',
  'onPointerdown',
  'onPointercancel',
  'onFocusin',
  'onFocusout',
  'onContextmenu',
  'onKeydown',
]);
const popupAttrs = computed(() =>
  Object.fromEntries(Object.entries(attrs).filter(([key]) => !triggerEventNames.has(key)))
);

function resolveElement(node: VNode): HTMLElement | undefined {
  if (node.component) return resolveElement(node.component.subTree);
  if (node.el instanceof HTMLElement) return node.el;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child && typeof child === 'object' && 'type' in child) {
        const element = resolveElement(child as VNode);
        if (element) return element;
      }
    }
  }
}

// Clone the first real child, preserving its ref/listeners and adding no layout wrapper.
const TriggerReference = defineComponent({
  name: 'VoexTriggerReference',
  setup() {
    return () => {
      contentEmpty.value = props.hideEmpty && !hasContent(slots.content?.(slotProps.value) ?? []);
      const children = flattenChildren(slots.default?.(slotProps.value) ?? []);
      const index = children.findIndex((node) => node.type !== Comment && node.type !== Text);
      const child = children[index];
      if (!child) return children;
      const events = Object.fromEntries(
        Object.entries(attrs).filter(([key]) => triggerEventNames.has(key))
      );
      const tooltip = attrs.role === 'tooltip';
      children[index] = cloneVNode(
        child,
        mergeProps(events, {
          class: visible.value ? props.openedClass : undefined,
          'aria-expanded': tooltip ? undefined : visible.value,
          'aria-controls': !tooltip && visible.value ? popupId.value : undefined,
          'aria-describedby':
            tooltip && visible.value
              ? [child.props?.['aria-describedby'], popupId.value].filter(Boolean).join(' ')
              : child.props?.['aria-describedby'],
          onClick: handleClick,
          onPointerdown: handlePointerDown,
          onPointercancel: handlePointerCancel,
          onPointerenter: handlePointerEnter,
          onPointerleave: handlePointerLeave,
          onPointermove: updatePoint,
          onFocusin: handleFocusIn,
          onFocusout: handleFocusOut,
          onContextmenu: handleContextmenu,
          onKeydown: handleKeydown,
          onVnodeMounted: (node: VNode) => {
            referenceRef.value = resolveElement(node);
          },
          onVnodeUpdated: (node: VNode) => {
            referenceRef.value = resolveElement(node);
          },
          onVnodeBeforeUnmount: (node: VNode) => {
            if (referenceRef.value === resolveElement(node)) referenceRef.value = undefined;
          },
        }),
        true
      );
      return children;
    };
  },
});

const teleportTarget = computed(() => {
  if (!mounted.value) return 'body';
  const doc = referenceRef.value?.ownerDocument ?? document;
  if (typeof props.popupContainer === 'string') {
    return doc.querySelector<HTMLElement>(props.popupContainer) ?? doc.body;
  }
  // A body portal is inert/behind the native top layer when opened inside a dialog.
  return props.popupContainer ?? referenceRef.value?.closest('dialog[open]') ?? doc.body;
});

const positioningOptions = computed<UseFloatingOptions>(() => {
  const fitWidth = props.autoFitPopupWidth;
  const minWidth = props.autoFitPopupMinWidth;
  const fitPosition = props.autoFitPosition;
  const translate = props.popupTranslate;
  const customWidth = props.popupStyle?.width;
  const customMinWidth = props.popupStyle?.minWidth;
  const middleware: Middleware[] = [offset(props.popupOffset)];
  if (translate)
    middleware.push({
      name: 'popupTranslate',
      fn: ({ x, y, placement }) => {
        const [dx, dy] = Array.isArray(translate)
          ? translate
          : (translate[placement] ?? translate[toTriggerPosition(placement)] ?? [0, 0]);
        return { x: x + dx, y: y + dy };
      },
    });
  if (fitPosition) middleware.push(flip({ padding: 8 }), shift({ padding: 8 }));
  middleware.push(
    size({
      padding: 8,
      apply: ({ rects, elements, availableWidth, availableHeight }) => {
        if (!visible.value || popupRef.value !== elements.floating) return;
        const style = elements.floating.style;
        const width = fitWidth ? `${rects.reference.width}px` : customWidth;
        const minimum = minWidth ? `${rects.reference.width}px` : customMinWidth;
        style.width = typeof width === 'number' ? `${width}px` : (width ?? '');
        style.minWidth = typeof minimum === 'number' ? `${minimum}px` : (minimum ?? '');
        if (fitPosition) {
          style.setProperty('--voex-trigger-available-width', `${Math.max(0, availableWidth)}px`);
          style.setProperty('--voex-trigger-available-height', `${Math.max(0, availableHeight)}px`);
        } else {
          style.removeProperty('--voex-trigger-available-width');
          style.removeProperty('--voex-trigger-available-height');
        }
        const nextSize = `${rects.reference.width},${rects.reference.height}`;
        if (referenceSize !== undefined && referenceSize !== nextSize) emit('resize');
        referenceSize = nextSize;
      },
    })
  );
  if (props.showArrow && arrowRef.value)
    middleware.push(arrow({ element: arrowRef.value, padding: 6 }));
  return {
    placement: toPlacement(props.position),
    strategy: props.strategy,
    middleware,
    autoUpdate: {
      ancestorScroll: props.updateAtScroll,
      ancestorResize: true,
      elementResize: props.autoFixPosition,
      layoutShift: props.autoFixPosition,
    },
  };
});

const popupStyles = computed<CSSProperties>(() => ({
  ...props.popupStyle,
  ...transformStyle.value,
  ...floating.floatingStyle.value,
  zIndex: props.popupZIndex ?? `calc(var(--voex-trigger-layer) + ${depth})`,
  visibility:
    visible.value && !floating.isPositioned.value ? 'hidden' : props.popupStyle?.visibility,
}));
const side = computed(() => placement.value.split('-')[0] as 'top' | 'bottom' | 'left' | 'right');
const arrowStyles = computed<CSSProperties>(() => {
  const data = floating.position.value?.middlewareData.arrow;
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
  const vertical = side.value === 'top' || side.value === 'bottom';
  const length = vertical ? arrowRef.value?.offsetHeight : arrowRef.value?.offsetWidth;
  return {
    ...props.arrowStyle,
    left: data?.x === undefined ? undefined : `${data.x}px`,
    top: data?.y === undefined ? undefined : `${data.y}px`,
    right: undefined,
    bottom: undefined,
    [opposite[side.value]]: `${-(length ?? 8) / 2}px`,
  };
});
const transformStyle = computed<CSSProperties>(() => {
  if (!props.autoFitTransformOrigin) return {};
  const data = floating.position.value?.middlewareData.arrow;
  const x = data?.x === undefined ? '50%' : `${data.x + (arrowRef.value?.offsetWidth ?? 8) / 2}px`;
  const y = data?.y === undefined ? '50%' : `${data.y + (arrowRef.value?.offsetHeight ?? 8) / 2}px`;
  return {
    transformOrigin: {
      top: `${x} bottom`,
      bottom: `${x} top`,
      left: `right ${y}`,
      right: `left ${y}`,
    }[side.value],
  };
});

watch(
  [visible, referenceRef, popupRef, () => props.alignPoint, teleportTarget],
  async () => {
    if (!visible.value || !referenceRef.value || !popupRef.value) {
      floating.hide();
      return;
    }
    // Teleport/v-show and any new content must be committed before measuring.
    await nextTick();
    if (!visible.value || !referenceRef.value || !popupRef.value) return;
    floating.virtualElement.contextElement = referenceRef.value;
    if (props.alignPoint && !hasPoint) {
      const rect = referenceRef.value.getBoundingClientRect();
      floating.virtualElement.getBoundingClientRect = floating.generateGetBoundingClientRect(
        rect.left + rect.width / 2,
        rect.bottom
      );
    }
    floating.init(
      props.alignPoint ? floating.virtualElement : referenceRef.value,
      popupRef.value,
      positioningOptions.value
    );
    floating.show();
  },
  { flush: 'post' }
);

watch(positioningOptions, (options) => {
  if (visible.value) floating.setOptions(options);
});
watch(() => props.popupVisible, clearTimer);
watch(() => props.trigger, clearTimer, { deep: true });
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) hide();
  }
);
watch(visible, (value) => {
  if (!value) {
    clearTimer();
    if (popupRef.value?.contains(popupRef.value.ownerDocument.activeElement)) restoreFocus();
  }
});
watchEffect((onCleanup) => {
  if (!mounted.value || !visible.value) return;
  const doc = referenceRef.value?.ownerDocument ?? document;
  const outside = (event: PointerEvent) => {
    if (props.clickOutsideToClose && !isInside(event.target, event.composedPath())) hide();
  };
  doc.addEventListener('pointerdown', outside, true);
  doc.addEventListener('keydown', handleKeydown);
  onCleanup(() => {
    doc.removeEventListener('pointerdown', outside, true);
    doc.removeEventListener('keydown', handleKeydown);
  });
});

function handleBeforeEnter(element: Element) {
  // A cancelled leave may reuse a VNode whose old props still say it is visible.
  element.removeAttribute('inert');
  element.setAttribute('aria-hidden', 'false');
}

function handleBeforeLeave(element: Element) {
  // v-if removal keeps the last VNode props throughout the leave transition.
  element.setAttribute('inert', '');
  element.setAttribute('aria-hidden', 'true');
}

function handleShow() {
  if (visible.value) emit('show');
}
function handleHide() {
  if (!visible.value) {
    if (props.unmountOnClose) floating.destroy();
    emit('hide');
  }
}
onMounted(() => {
  mounted.value = true;
});
onActivated(() => {
  active.value = true;
});
onDeactivated(() => {
  active.value = false;
  hide();
  floating.hide();
});
onBeforeUnmount(() => {
  active.value = false;
  clearTimer();
  parent?.unregister(popupRef);
});
defineExpose({ show, hide, update: floating.update, visible, referenceRef, popupRef });
</script>

<style lang="stylus">
.voex-trigger__popup
  --voex-trigger-layer 300
  position absolute
  top 0
  left 0
  width max-content
  max-width min(calc(100vw - 16px), var(--voex-trigger-available-width, calc(100vw - 16px)))
  box-sizing border-box

.voex-trigger__wrapper
  position relative

.voex-trigger__content
  position relative
  z-index 1
  box-sizing border-box
  max-width inherit
  max-height var(--voex-trigger-available-height, calc(100vh - 16px))
  overflow auto
  color var(--color-text-primary)
  background var(--color-bg-secondary)
  border-radius var(--border-radius-item-s, 6px)
  box-shadow var(--shadow-medium)

.voex-trigger__arrow
  position absolute
  width 8px
  height 8px
  pointer-events none
  background var(--color-bg-secondary)
  transform rotate(45deg)

.voex-trigger-fade-enter-active,
.voex-trigger-fade-leave-active
  transition opacity 120ms ease

.voex-trigger-fade-enter-from,
.voex-trigger-fade-leave-to
  opacity 0

@media (prefers-reduced-motion: reduce)
  .voex-trigger-fade-enter-active,
  .voex-trigger-fade-leave-active
    transition none
</style>
