<template>
  <Teleport to="body">
    <Transition name="voex-modal" @before-leave="closeDialog">
      <dialog
        v-if="modelValue || keepMounted"
        v-show="!keepMounted || modelValue"
        ref="dialogRef"
        v-bind="$attrs"
        class="voex-modal-dialog"
        :class="{ 'voex-modal-dialog--drawer': placement !== 'center' }"
        :style="viewportStyle"
        aria-modal="true"
        :aria-labelledby="title || $slots.header ? titleId : undefined"
        :aria-label="title || $slots.header ? undefined : '对话框'"
        :aria-busy="busy"
        @cancel.prevent="handleClose"
        @close="handleNativeClose"
        @keydown="handleKeydown"
      >
        <div class="voex-modal-mask" aria-hidden="true" @click.self="handleMaskClick" />
        <div class="voex-modal-wrapper" :class="wrapperClass">
          <div class="voex-modal" :style="modalStyle">
            <!-- Header -->
            <div
              v-if="title || $slots.header"
              :id="$slots.header ? titleId : undefined"
              class="voex-modal__header"
            >
              <slot name="header">
                <span :id="titleId" class="voex-modal__title">{{ title }}</span>
                <button
                  v-if="closable"
                  type="button"
                  class="voex-modal__close"
                  :aria-label="placement === 'center' ? '关闭弹窗' : '关闭抽屉'"
                  :disabled="busy || closeDisabled"
                  @click="handleClose"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M4 4L12 12M12 4L4 12"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                    />
                  </svg>
                </button>
              </slot>
            </div>

            <!-- Body -->
            <div class="voex-modal__body">
              <slot />
            </div>

            <!-- Footer -->
            <div v-if="$slots.footer" class="voex-modal__footer">
              <slot name="footer" />
            </div>
          </div>
        </div>
      </dialog>
    </Transition>
  </Teleport>
</template>

<script lang="ts">
export interface VoexModalProps {
  modelValue?: boolean;
  keepMounted?: boolean;
  title?: string;
  width?: string | number;
  closable?: boolean;
  maskClosable?: boolean;
  centered?: boolean;
  placement?: 'center' | 'left' | 'right';
  height?: string | number;
  busy?: boolean;
  closeDisabled?: boolean;
}

type ModalSession = {
  dialog: HTMLDialogElement;
  previousFocus: HTMLElement | null;
};

// Shared by registered dialogs, drawers, and other VoexModal instances.
const modalStack: ModalSession[] = [];
let restorePageScroll: (() => void) | undefined;

function lockPageScroll() {
  const root = document.documentElement;
  const body = document.body;
  const { scrollX, scrollY } = window;
  const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
  const paddingRight = parseFloat(getComputedStyle(body).paddingRight) || 0;
  const saved: { element: HTMLElement; property: string; value: string; priority: string }[] = [];
  function setStyle(element: HTMLElement, property: string, value: string) {
    saved.push({
      element,
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    });
    element.style.setProperty(property, value);
  }
  setStyle(root, 'overflow-x', 'hidden');
  setStyle(root, 'overflow-y', 'hidden');
  setStyle(body, 'position', 'fixed');
  setStyle(body, 'top', `${-scrollY}px`);
  setStyle(body, 'left', `${-scrollX}px`);
  setStyle(body, 'width', '100%');
  setStyle(body, 'overflow-x', 'hidden');
  setStyle(body, 'overflow-y', 'hidden');
  if (scrollbarWidth && !getComputedStyle(root).scrollbarGutter.includes('stable')) {
    setStyle(body, 'padding-right', `${paddingRight + scrollbarWidth}px`);
  }
  restorePageScroll = () => {
    for (const { element, property, value, priority } of saved) {
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    }
    window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
  };
}

function releaseModal(session: ModalSession) {
  const index = modalStack.indexOf(session);
  if (index === -1) return;
  const wasTop = index === modalStack.length - 1;
  // If a lower dialog disappears first, its successor must restore the original opener.
  for (const other of modalStack.slice(index + 1)) {
    if (other.previousFocus && session.dialog.contains(other.previousFocus)) {
      other.previousFocus = session.previousFocus;
    }
  }
  modalStack.splice(index, 1);
  if (session.dialog.open) session.dialog.close();
  if (!modalStack.length) {
    restorePageScroll?.();
    restorePageScroll = undefined;
  }
  const top = modalStack.at(-1);
  const target = session.previousFocus;
  if (!wasTop) return;
  if (
    target?.isConnected &&
    target.getClientRects().length &&
    !target.matches(':disabled') &&
    !target.closest('[inert]') &&
    (!top || top.dialog.contains(target))
  ) {
    target.focus({ preventScroll: true });
  } else if (top) {
    (getTabStops(top.dialog)[0] ?? top.dialog).focus({ preventScroll: true });
  }
}

function getTabStops(root: ParentNode): HTMLElement[] {
  const stops: HTMLElement[] = [];
  function visit(element: Element) {
    if (!(element instanceof HTMLElement) || element.inert || element.hidden) return;
    if (
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      element.getClientRects().length &&
      getComputedStyle(element).visibility !== 'hidden'
    ) {
      stops.push(element);
    }
    // FileViewer renders controls inside a shadow root; follow the composed tree.
    const assigned =
      element instanceof HTMLSlotElement ? element.assignedElements({ flatten: true }) : [];
    const children = assigned.length ? assigned : (element.shadowRoot ?? element).children;
    for (const child of children) visit(child);
  }
  for (const element of root.children) visit(element);
  return stops.sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<VoexModalProps>(), {
  modelValue: false,
  keepMounted: false,
  title: '',
  width: 420,
  height: 'auto',
  closable: true,
  maskClosable: true,
  centered: true,
  placement: 'center',
  busy: false,
  closeDisabled: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'close'): void;
  (e: 'open'): void;
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
const titleId = useId();
const viewportStyle = ref<Record<string, string>>({});
let session: ModalSession | undefined;
let closeRequested = false;

function updateViewport() {
  const viewport = window.visualViewport;
  viewportStyle.value = viewport
    ? {
        '--voex-modal-viewport-height': `${viewport.height}px`,
        '--voex-modal-viewport-width': `${viewport.width}px`,
        '--voex-modal-viewport-top': `${viewport.offsetTop}px`,
        '--voex-modal-viewport-left': `${viewport.offsetLeft}px`,
      }
    : {};
}

function closeDialog() {
  window.visualViewport?.removeEventListener('resize', updateViewport);
  window.visualViewport?.removeEventListener('scroll', updateViewport);
  if (!session) return;
  const current = session;
  session = undefined;
  releaseModal(current);
}

watch(
  [() => props.modelValue, dialogRef],
  ([visible, dialog]) => {
    if (session && (!visible || session.dialog !== dialog)) closeDialog();
    if (!visible || !dialog?.isConnected || session) return;
    closeRequested = false;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!modalStack.length) lockPageScroll();
    session = { dialog, previousFocus };
    modalStack.push(session);
    // showModal supplies the top layer, background inertness and native focus containment.
    dialog.showModal();
    const openedSession = session;
    // Retained drawers may finish becoming visible after showModal's native focus step.
    nextTick(() => {
      if (session !== openedSession || modalStack.at(-1) !== openedSession) return;
      if (!dialog.contains(document.activeElement)) {
        (getTabStops(dialog)[0] ?? dialog).focus({ preventScroll: true });
      }
    });
    updateViewport();
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    emit('open');
  },
  { flush: 'post', immediate: true }
);

onBeforeUnmount(closeDialog);

const modalStyle = computed(() => ({
  width: typeof props.width === 'number' ? `${props.width}px` : props.width,
  height: typeof props.height === 'number' ? `${props.height}px` : props.height,
}));

const wrapperClass = computed(() => ({
  'voex-modal-wrapper--centered': props.placement === 'center' && props.centered,
  'voex-modal-wrapper--left': props.placement === 'left',
  'voex-modal-wrapper--right': props.placement === 'right',
}));

function handleClose() {
  if (!props.modelValue || props.busy || props.closeDisabled || closeRequested) return;
  closeRequested = true;
  emit('update:modelValue', false);
  emit('close');
  // A close callback may immediately open another session without a false render.
  nextTick(() => {
    if (props.modelValue) closeRequested = false;
  });
}

function handleNativeClose(event: Event) {
  // Ignore the queued native close event after a controlled close/unmount.
  const dialog = session?.dialog;
  if (!dialog || event.target !== dialog || dialog.open) return;
  if (props.busy || props.closeDisabled) dialog.showModal();
  else handleClose();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') event.stopPropagation();
  if (event.key !== 'Tab' || event.defaultPrevented || !session || modalStack.at(-1) !== session)
    return;
  const stops = getTabStops(session.dialog);
  const first = stops[0];
  const last = stops.at(-1);
  const active = event.composedPath()[0];
  if (!first || !last) {
    event.preventDefault();
    session.dialog.focus({ preventScroll: true });
  } else if (event.shiftKey && (active === first || active === session.dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || active === session.dialog)) {
    event.preventDefault();
    first.focus();
  }
}

function handleMaskClick() {
  if (props.maskClosable) {
    handleClose();
  }
}
</script>

<style scoped lang="stylus">
.voex-modal-dialog
  position fixed
  top var(--voex-modal-viewport-top, 0px)
  left var(--voex-modal-viewport-left, 0px)
  right auto
  bottom auto
  width var(--voex-modal-viewport-width, 100%)
  height 100dvh
  height var(--voex-modal-viewport-height, 100dvh)
  max-width none
  max-height none
  margin 0
  padding 0
  border 0
  color inherit
  font inherit
  background transparent
  overflow hidden

  &[open]
    display flex

  &::backdrop
    background transparent

.voex-modal-mask
  position absolute
  inset 0
  background var(--color-overlay-primary)

.voex-modal-wrapper
  position relative
  display flex
  align-items flex-start
  justify-content center
  width 100%
  height 100%
  padding 40px 24px
  pointer-events none

  &--centered
    align-items center
    justify-content center

.voex-modal
  position relative
  max-width 100%
  max-height 100%
  min-height 0
  flex-shrink 0
  overflow hidden
  background var(--color-bg-secondary)
  border-radius 8px
  box-shadow var(--shadow-high)
  pointer-events auto
  display flex
  flex-direction column

.voex-modal__header
  flex-shrink 0
  display flex
  align-items center
  justify-content space-between
  padding 16px 20px 0
  user-select none

.voex-modal__title
  min-width 0
  overflow-wrap anywhere
  font-size 16px
  font-weight 600
  color var(--color-text-primary)
  line-height 22px

.voex-modal__close
  display flex
  align-items center
  justify-content center
  width 28px
  height 28px
  border none
  border-radius 4px
  background transparent
  color var(--color-text-tertiary)
  cursor pointer
  transition background 0.2s, color 0.2s
  flex-shrink 0

  &:not(:disabled):hover
    background var(--color-bg-translucent)
    color var(--color-text-primary)

  &:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset 2px

  &:disabled
    cursor not-allowed
    opacity 0.5

.voex-modal__body
  min-height 0
  padding 16px 20px
  flex 1
  color var(--color-text-primary)
  font-size 14px
  line-height 1.6
  overflow-y auto
  overscroll-behavior contain

.voex-modal__footer
  flex-shrink 0
  display flex
  align-items center
  justify-content flex-end
  gap 8px
  padding 0 20px 16px

// Transition
.voex-modal-enter-active,
.voex-modal-leave-active
  transition opacity 0.25s ease

.voex-modal-wrapper
  transition transform 0.25s ease

.voex-modal-enter-from,
.voex-modal-leave-to
  opacity 0

  .voex-modal-wrapper
    transform scale(0.95) translateY(-8px)

@media (max-width: 600px), (max-height: 600px)
  .voex-modal-wrapper
    padding 16px 12px
    padding-top unquote('max(16px, env(safe-area-inset-top))')
    padding-right unquote('max(12px, env(safe-area-inset-right))')
    padding-bottom unquote('max(16px, env(safe-area-inset-bottom))')
    padding-left unquote('max(12px, env(safe-area-inset-left))')

.voex-modal-dialog--drawer
  .voex-modal-wrapper
    padding 0
    align-items stretch
    transform none

    &--left
      justify-content flex-start

    &--right
      justify-content flex-end

  .voex-modal
    max-width calc(100% - 40px)
    border-radius 0
    padding-left env(safe-area-inset-left)
    padding-right env(safe-area-inset-right)
    transition transform .25s ease

  .voex-modal__header
    min-height 56px
    padding 6px 12px 6px 16px
    padding-top unquote('max(6px, env(safe-area-inset-top))')
    border-bottom 1px solid var(--color-border-primary)
    gap 12px

  .voex-modal__close
    width 44px
    height 44px
    border-radius 50%

    &:active
      background var(--color-bg-translucent)

  .voex-modal__body
    display flex
    flex-direction column
    padding 0
    padding-bottom env(safe-area-inset-bottom)
    overflow hidden

  &.voex-modal-enter-from, &.voex-modal-leave-to
    .voex-modal-wrapper
      transform none

    .voex-modal-wrapper--left .voex-modal
      transform translateX(-100%)

    .voex-modal-wrapper--right .voex-modal
      transform translateX(100%)

@media (prefers-reduced-motion: reduce)
  .voex-modal-dialog--drawer .voex-modal
    transition none

  .voex-modal-enter-active,
  .voex-modal-leave-active
    transition none

    .voex-modal-wrapper
      transition none
</style>
