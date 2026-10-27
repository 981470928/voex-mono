<template>
  <div
    ref="root"
    class="download-queue"
    :class="{ 'download-queue--popover': isPopover }"
    @keydown.esc="onEscape"
  >
    <button
      ref="trigger"
      type="button"
      :class="isPopover ? 'edit-page__icon-button' : 'download-queue__trigger'"
      :title="isPopover ? '下载列表' : undefined"
      :aria-label="isPopover ? '下载列表' : undefined"
      :aria-expanded="store.expanded"
      :aria-controls="panelId"
      @click="toggle"
    >
      <SvgIcon :name="isPopover ? 'inbox' : 'download'" :size="18" />
      <span v-if="!isPopover">下载</span>
      <span v-if="store.activeCount" class="download-queue__count">{{ store.activeCount }}</span>
      <SvgIcon
        v-if="!isPopover"
        name="chevron-right"
        :size="14"
        class="download-queue__chevron"
        :class="{ 'download-queue__chevron--expanded': store.expanded }"
      />
    </button>
    <Teleport to="body" :disabled="!isPopover">
      <section
        v-show="store.expanded"
        :id="panelId"
        ref="panel"
        class="download-queue__panel"
        :class="{ 'download-queue__panel--popover': isPopover }"
        :aria-labelledby="titleId"
        :tabindex="isPopover ? -1 : undefined"
        @keydown.esc="onEscape"
      >
        <header class="download-queue__header">
          <div>
            <h2 :id="titleId">下载列表</h2>
            <p aria-live="polite">{{ summary }}</p>
          </div>
          <button
            type="button"
            class="download-queue__action"
            :disabled="!hasFinished"
            @click="store.clearFinished"
          >
            清除记录
          </button>
          <button
            type="button"
            class="download-queue__action download-queue__close"
            aria-label="收起下载列表"
            title="收起下载列表"
            @click="close()"
          >
            <SvgIcon name="close" :size="16" />
          </button>
        </header>
        <ul v-if="store.items.length" class="download-queue__list" aria-label="下载任务">
          <li v-for="item in displayedItems" :key="item.id" class="download-queue__item">
            <div class="download-queue__row">
              <SvgIcon name="page" :size="18" class="download-queue__file-icon" />
              <span class="download-queue__name">{{ item.name }}</span>
              <button
                v-if="item.status === 'queued' || item.status === 'downloading'"
                type="button"
                class="download-queue__action"
                :aria-label="'中止下载：' + item.name"
                @click="cancel(item.id)"
              >
                中止
              </button>
            </div>
            <div class="download-queue__details">
              <span
                class="download-queue__status"
                :class="{ 'download-queue__status--failed': item.status === 'failed' }"
                aria-live="polite"
                >{{ statusText[item.status] }}</span
              >
              <span v-if="item.status === 'downloading'" class="download-queue__bytes">
                {{ formatBytes(item.loaded) }}
                <template v-if="item.total !== null">
                  / {{ formatBytes(item.total) }} · {{ percent(item) }}%
                </template>
              </span>
            </div>
            <progress
              v-if="item.status === 'downloading'"
              class="download-queue__progress"
              :value="item.total === null ? undefined : percent(item)"
              max="100"
              :aria-label="item.name + '下载进度'"
            />
            <p v-if="item.error" class="download-queue__error">{{ item.error }}</p>
          </li>
        </ul>
        <p v-else class="download-queue__empty">暂无下载任务<br />点击附件的下载按钮开始</p>
      </section>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { flip, offset, shift, size } from '@floating-ui/dom';
import { useFloating } from '@/composables/useFloating';
import SvgIcon from '@/components/SvgIcon.vue';
import {
  isDownloadActive,
  useDownloadStore,
  type DownloadItem,
  type DownloadStatus,
} from '@/stores/download';

const props = withDefaults(defineProps<{ variant?: 'inline' | 'popover' }>(), {
  variant: 'inline',
});
const isPopover = computed(() => props.variant === 'popover');
const id = useId();
const panelId = id + '-download-panel';
const titleId = id + '-download-title';
const root = ref<HTMLElement>();
const panel = ref<HTMLElement>();
const floating = useFloating();
const store = useDownloadStore();
const trigger = ref<HTMLButtonElement>();
const displayedItems = computed(() => [
  ...store.items.filter(isDownloadActive),
  ...store.items.filter((item) => !isDownloadActive(item)).reverse(),
]);
const hasFinished = computed(() => store.items.some((item) => !isDownloadActive(item)));
const summary = computed(() =>
  store.activeCount ? store.activeCount + ' 个任务进行中' : '当前没有进行中的下载'
);
const statusText: Record<DownloadStatus, string> = {
  queued: '排队等待',
  downloading: '正在下载',
  saving: '正在交给浏览器',
  completed: '已交给浏览器',
  canceled: '已中止',
  failed: '下载失败',
};
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });

function formatBytes(bytes: number) {
  if (bytes < 1024) return numberFormat.format(bytes) + ' B';
  if (bytes < 1024 ** 2) return numberFormat.format(bytes / 1024) + ' KB';
  if (bytes < 1024 ** 3) return numberFormat.format(bytes / 1024 ** 2) + ' MB';
  return numberFormat.format(bytes / 1024 ** 3) + ' GB';
}

function percent(item: DownloadItem) {
  return item.total ? Math.min(100, Math.floor((item.loaded / item.total) * 100)) : 0;
}

async function toggle() {
  if (store.expanded) {
    close();
    return;
  }
  store.expanded = true;
  await nextTick();
  if (isPopover.value) panel.value?.focus({ preventScroll: true });
}

function close(restoreFocus = true) {
  store.expanded = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}

function syncPopover() {
  if (!isPopover.value || !store.expanded || !trigger.value || !panel.value) {
    floating.hide();
    return;
  }
  floating.init(trigger.value, panel.value, {
    strategy: 'fixed',
    placement: 'right-start',
    middleware: [
      offset(12),
      flip({ padding: 12 }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = Math.max(0, Math.min(420, availableHeight)) + 'px';
        },
      }),
    ],
  });
  floating.show();
}

function onOutsidePointer(event: PointerEvent) {
  if (!isPopover.value || !store.expanded || !(event.target instanceof Node)) return;
  if (!root.value?.contains(event.target) && !panel.value?.contains(event.target)) close(false);
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (isPopover.value && event.key === 'Escape') onEscape(event);
}

watch(() => [store.expanded, isPopover.value], syncPopover, { flush: 'post' });
onMounted(() => {
  if (!isPopover.value) return;
  document.addEventListener('pointerdown', onOutsidePointer);
  document.addEventListener('keydown', onDocumentKeydown);
  syncPopover();
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutsidePointer);
  document.removeEventListener('keydown', onDocumentKeydown);
  if (isPopover.value) store.expanded = false;
});

async function cancel(id: number) {
  store.cancel(id);
  await nextTick();
  trigger.value?.focus();
}

function onEscape(event: KeyboardEvent) {
  if (!store.expanded || event.defaultPrevented || event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  close();
}
</script>

<style scoped lang="stylus">
.download-queue
  display flex
  flex-direction column
  flex-shrink 0
  min-width 0
  border-top 1px solid var(--color-border-primary)
  color var(--color-text-primary)
  font-size 13px
  line-height 1.5
  &__trigger
    display flex
    align-items center
    gap 8px
    width 100%
    min-height 44px
    padding 10px 16px
    border 0
    background transparent
    color var(--color-text-primary)
  &__count
    min-width 20px
    padding 0 5px
    border-radius 4px
    background var(--color-brand-bg)
    color var(--color-brand-text)
    font-size 12px
    text-align center
    font-variant-numeric tabular-nums
  &__chevron
    margin-left auto
    transform rotate(90deg)
    &--expanded
      transform rotate(-90deg)
  &__panel
    display flex
    flex-direction column
    min-height 0
    max-height 42dvh
    border-top 1px solid var(--color-border-primary)
    background var(--color-bg-secondary)
    overflow hidden
  &__header
    display flex
    align-items center
    gap 4px
    flex-shrink 0
    padding 12px
    border-bottom 1px solid var(--color-border-primary)
    > div
      flex 1
      min-width 0
    h2
      margin 0
      font-size 14px
      font-weight 600
    p
      margin 3px 0 0
      font-size 12px
      color var(--color-text-tertiary)
  &__action
    display inline-flex
    align-items center
    justify-content center
    flex-shrink 0
    min-height 36px
    padding 6px 8px
    border-radius 6px
    color var(--color-text-secondary)
    font-size 12px
    white-space nowrap
  &__close
    width 36px
  &__trigger, &__action
    cursor pointer
    &:hover:not(:disabled)
      background var(--color-bg-tertiary)
    &:active:not(:disabled)
      background var(--color-bg-quaternary)
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px
    &:disabled
      opacity .45
      cursor not-allowed
  &__list
    min-height 0
    max-height 280px
    overflow-y auto
    overscroll-behavior contain
    scrollbar-gutter stable
    margin 0
    padding 0
    list-style none
  &__item
    padding 12px 14px
    & + &
      border-top 1px solid var(--color-border-primary)
  &__row
    display flex
    align-items flex-start
    gap 8px
  &__file-icon
    margin-top 2px
    color var(--color-text-tertiary)
  &__name
    flex 1
    min-width 0
    overflow-wrap anywhere
  &__details
    display flex
    flex-wrap wrap
    justify-content space-between
    gap 4px 10px
    margin-top 6px
    color var(--color-text-tertiary)
    font-size 12px
  &__bytes
    font-variant-numeric tabular-nums
  &__progress
    display block
    width 100%
    height 6px
    margin-top 8px
    border 0
    border-radius 3px
    overflow hidden
    accent-color var(--color-accent)
    &::-webkit-progress-bar
      background var(--color-bg-quaternary)
    &::-webkit-progress-value
      background var(--color-accent)
    &::-moz-progress-bar
      background var(--color-accent)
  &__status--failed, &__error
    color var(--color-red)
  &__error
    margin 6px 0 0
    font-size 12px
    overflow-wrap anywhere
  &__empty
    margin 0
    padding 28px 16px
    color var(--color-text-tertiary)
    text-align center


  &--popover
    position relative
    overflow visible
    border 0

    .download-queue__count
      position absolute
      top -4px
      right -6px
      min-width 18px
      padding 0 4px
      border-radius 9px
      font-size 10px
      line-height 18px
      pointer-events none

  &__panel--popover
    position fixed
    z-index 200
    width unquote('min(360px, calc(100vw - 88px))')
    max-height unquote('min(420px, calc(100dvh - 24px))')
    border 0
    border-radius var(--border-radius-container)
    background var(--color-bg-secondary)
    box-shadow var(--shadow-medium)
    color var(--color-text-primary)
    font-size 13px
    line-height 1.5

    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset 2px

    .download-queue__header
      border 0
      align-items flex-start

    .download-queue__list
      flex 1
      max-height none
      padding 0 8px 8px

    .download-queue__item
      border 0
      border-radius var(--border-radius-item-m)
      background var(--color-bg-translucent)

      & + .download-queue__item
        margin-top 8px

@media print
  .download-queue, .download-queue__panel--popover
    display none
</style>
