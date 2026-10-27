import {
  autoUpdate,
  computePosition,
  type AutoUpdateOptions,
  type ComputePositionConfig,
  type ComputePositionReturn,
  type ReferenceElement,
  type VirtualElement,
} from '@floating-ui/dom';
import { computed, onScopeDispose, readonly, ref, shallowRef, type CSSProperties } from 'vue';

export interface UseFloatingOptions extends Partial<ComputePositionConfig> {
  /** Only observe while shown. false keeps manual update() available. */
  autoUpdate?: boolean | AutoUpdateOptions;
}

export interface UseFloatingCallbacks {
  onShow?: () => void;
  onHide?: () => void;
  onUpdate?: (position: ComputePositionReturn) => void;
  onError?: (error: unknown) => void;
}

/** Coordinates are viewport-relative, including when used for a virtual reference. */
export function generateGetBoundingClientRect(x = 0, y = 0, width = 0, height = 0) {
  return (): DOMRect => ({
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({ x, y, width, height, top: y, right: x + width, bottom: y + height, left: x }),
  });
}

/** init() after mounting; show() after removing display:none; hide() stops observers. */
export function useFloating(callbacks: UseFloatingCallbacks = {}) {
  const reference = shallowRef<ReferenceElement>();
  const floating = shallowRef<HTMLElement>();
  const options = shallowRef<UseFloatingOptions>({});
  const visible = ref(false);
  const isPositioned = ref(false);
  const position = shallowRef<ComputePositionReturn>();
  const error = shallowRef<unknown>();
  const virtualElement: VirtualElement = { getBoundingClientRect: generateGetBoundingClientRect() };
  let cleanup: (() => void) | undefined;
  let requestId = 0;

  const floatingStyle = computed<CSSProperties>(() => ({
    position: options.value.strategy ?? 'absolute',
    left: `${position.value?.x ?? 0}px`,
    top: `${position.value?.y ?? 0}px`,
  }));

  function stopAutoUpdate() {
    cleanup?.();
    cleanup = undefined;
    // An already running computePosition must not write after hide/reinit/destroy.
    requestId++;
  }

  async function update() {
    const referenceElement = reference.value;
    const floatingElement = floating.value;
    if (!referenceElement || !floatingElement) return;
    const currentRequest = ++requestId;
    const { placement = 'bottom', strategy = 'absolute', middleware, platform } = options.value;
    try {
      const result = await computePosition(referenceElement, floatingElement, {
        placement,
        strategy,
        middleware,
        ...(platform ? { platform } : {}),
      });
      if (
        currentRequest !== requestId ||
        reference.value !== referenceElement ||
        floating.value !== floatingElement
      )
        return;
      position.value = result;
      Object.assign(floatingElement.style, floatingStyle.value);
      error.value = undefined;
      isPositioned.value = true;
      callbacks.onUpdate?.(result);
      return result;
    } catch (cause) {
      if (currentRequest !== requestId) return;
      error.value = cause;
      isPositioned.value = false;
      callbacks.onError?.(cause);
    }
  }

  function startAutoUpdate() {
    stopAutoUpdate();
    if (!visible.value || !reference.value || !floating.value) return;
    const settings = options.value.autoUpdate;
    if (settings === false) {
      void update();
      return;
    }
    cleanup = autoUpdate(
      reference.value,
      floating.value,
      () => void update(),
      typeof settings === 'object' ? settings : undefined
    );
  }

  function init(
    referenceElement: ReferenceElement,
    floatingElement: HTMLElement,
    config: UseFloatingOptions = {}
  ) {
    stopAutoUpdate();
    reference.value = referenceElement;
    floating.value = floatingElement;
    options.value = { ...config };
    position.value = undefined;
    error.value = undefined;
    isPositioned.value = false;
    Object.assign(floatingElement.style, floatingStyle.value);
    startAutoUpdate();
  }

  function setOptions(config: UseFloatingOptions) {
    options.value = { ...options.value, ...config };
    if (floating.value) Object.assign(floating.value.style, floatingStyle.value);
    startAutoUpdate();
  }

  function show() {
    if (visible.value || !reference.value || !floating.value) return;
    visible.value = true;
    isPositioned.value = false;
    startAutoUpdate();
    callbacks.onShow?.();
  }

  function hide() {
    const wasVisible = visible.value;
    visible.value = false;
    stopAutoUpdate();
    if (wasVisible) callbacks.onHide?.();
  }

  function destroy() {
    hide();
    reference.value = undefined;
    floating.value = undefined;
    position.value = undefined;
    error.value = undefined;
    isPositioned.value = false;
  }

  onScopeDispose(destroy);

  return {
    init,
    show,
    hide,
    update,
    setOptions,
    destroy,
    visible: readonly(visible),
    isPositioned: readonly(isPositioned),
    position: readonly(position),
    error: readonly(error),
    floatingStyle,
    virtualElement,
    generateGetBoundingClientRect,
  };
}
