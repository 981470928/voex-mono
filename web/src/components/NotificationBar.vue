<template>
  <Teleport :to="target">
    <div
      class="notification"
      :class="{ 'notification--active': store.notices.length > 0 }"
      aria-label="消息提示"
    >
      <div
        v-for="item in store.notices"
        :key="item.id"
        class="notification__message"
        :class="`notification__message--${item.tone}`"
        :role="item.tone === 'error' ? 'alert' : 'status'"
        aria-atomic="true"
      >
        <SvgIcon
          :name="
            item.tone === 'loading' ? 'loading' : item.tone === 'success' ? 'resolved' : 'info'
          "
          :size="20"
          :class="{ notification__spinner: item.tone === 'loading' }"
          aria-hidden="true"
        />
        <span class="notification__text">{{ item.message }}</span>
        <button
          v-if="item.action"
          type="button"
          class="notification__action"
          @click="store.runAction(item.id)"
        >
          {{ item.action.label }}
        </button>
        <button
          type="button"
          class="notification__close"
          aria-label="关闭提示"
          @click="store.dismiss(item.id)"
        >
          <SvgIcon name="close" :size="18" aria-hidden="true" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { useNotificationStore } from '@/stores/notification';
const store = useNotificationStore();
const target = shallowRef<HTMLElement | string>('body');
let observer: MutationObserver | undefined;
let dialogs: HTMLDialogElement[] = [];

// Native modal dialogs make body siblings inert. Follow opening order, including drawers.
function syncTarget(records: MutationRecord[] = []) {
  dialogs = dialogs.filter((dialog) => dialog.isConnected && dialog.open);
  for (const record of records) {
    if (record.type !== 'attributes' || !(record.target instanceof HTMLDialogElement)) continue;
    const dialog = record.target;
    dialogs = dialogs.filter((item) => item !== dialog);
    if (dialog.isConnected && dialog.open) dialogs.push(dialog);
  }
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]'))
    if (!dialogs.includes(dialog)) dialogs.push(dialog);
  target.value = dialogs.at(-1) ?? document.body;
}
onMounted(() => {
  syncTarget();
  observer = new MutationObserver((records) => {
    const changed = records.some(
      (record) =>
        record.type === 'attributes' ||
        [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node instanceof HTMLDialogElement || node.querySelector('dialog'))
        )
    );
    if (changed) syncTarget(records);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
  });
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<style scoped lang="stylus">
.notification
  position fixed
  z-index 2000
  bottom 28px
  left 50%
  transform translateX(-50%)
  display flex
  flex-direction column
  gap 8px
  width max-content
  max-width calc(100vw - 32px)
  max-height min(50dvh, 360px)
  padding 4px
  overflow-y auto
  overscroll-behavior contain
  pointer-events none
  &--active
    pointer-events auto
  &__message
    display flex
    align-items center
    flex-shrink 0
    gap 10px
    padding 12px 16px
    border 1px solid var(--color-border-primary)
    border-radius 8px
    background var(--color-bg-secondary)
    color var(--color-text-primary)
    box-shadow var(--shadow-medium)
    font-size 14px
    line-height 1.6
    overflow-wrap anywhere
    pointer-events auto
    > svg
      flex-shrink 0
      color var(--color-blue)
    &--error > svg
      color var(--color-red)
    &--success > svg
      color var(--color-green)
  &__text
    min-width 0
    flex 1
  &__action, &__close
    display inline-flex
    align-items center
    justify-content center
    flex-shrink 0
    padding 4px
    border 0
    background transparent
    color var(--color-text-secondary)
    font inherit
    border-radius 4px
    cursor pointer
    &:hover:not(:disabled)
      background var(--color-bg-translucent)
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px
    &:active:not(:disabled)
      background var(--color-bg-tertiary)
    &:disabled
      opacity .5
      cursor not-allowed
  &__action
    color var(--color-accent)
    font-size 13px
  &__spinner
    animation notification-spin 1s linear infinite

@keyframes notification-spin
  to
    transform rotate(360deg)

@media (max-width: 480px)
  .notification
    bottom 16px
    &__message
      padding 10px
      gap 6px

@media (prefers-reduced-motion: reduce)
  .notification__spinner
    animation none
</style>
