<template>
  <div class="file-list">
    <div class="file-list__toolbar">
      <div class="file-list__navigation"><slot name="navigation" /></div>
      <div class="file-list__tools">
        <div class="file-list__view" role="group" aria-label="展示方式">
          <button
            v-for="mode in viewModes"
            :key="mode.value"
            class="file-list__icon-button file-list__tool"
            :class="{ 'file-list__icon-button--selected': view === mode.value }"
            type="button"
            :aria-pressed="view === mode.value"
            :title="mode.label"
            :aria-label="mode.label"
            @click="setView(mode.value)"
          >
            <SvgIcon :name="mode.value" :size="16" />
          </button>
        </div>
        <slot name="actions" />
        <button
          class="file-list__icon-button file-list__tool"
          type="button"
          :title="refreshLabel"
          :aria-label="refreshLabel"
          :disabled="loading || busy"
          @click="refresh"
        >
          <SvgIcon name="refresh" :size="14" />
        </button>
      </div>
    </div>
    <section
      ref="contentElement"
      class="file-list__content"
      :aria-busy="loading"
      :aria-label="label"
      tabindex="-1"
    >
      <div v-if="loading" class="file-list__state" role="status">
        <span class="file-list__spinner" aria-hidden="true" />
        <p>{{ loadingLabel }}</p>
      </div>
      <div v-else-if="error" class="file-list__state" role="alert">
        <SvgIcon name="alert" :size="32" />
        <h2>{{ errorTitle }}</h2>
        <p>{{ error }}</p>
        <div class="file-list__state-actions">
          <button class="file-list__button" type="button" :disabled="busy" @click="refresh">
            重新加载
          </button>
          <slot name="error-actions" />
        </div>
      </div>
      <div v-else-if="!entries.length" class="file-list__state">
        <SvgIcon :name="emptyIcon" :size="40" />
        <h2>{{ emptyTitle }}</h2>
        <p>{{ emptyDescription }}</p>
        <slot name="empty-actions" />
      </div>
      <template v-else>
        <div v-if="view === 'list'" class="file-list__heading" aria-hidden="true">
          <span>名称</span><span class="file-list__type">{{ typeLabel }}</span>
          <span class="file-list__time">{{ timeLabel }}</span
          ><span>操作</span>
        </div>
        <ul class="file-list__entries" :class="`file-list__entries--${view}`">
          <li
            v-for="entry in entries"
            :key="entry.kind + '-' + entry.key"
            class="file-list__entry"
            :class="{
              'file-list__entry--context': isMenuOpen(entry),
              'file-list__entry--unavailable': !entry.location,
            }"
            :data-entry-key="entry.key"
            @contextmenu.prevent.stop="openMenu($event, entry)"
            @keydown="handleEntryKeydown($event, entry)"
          >
            <component
              :is="entry.location ? RouterLink : 'div'"
              class="file-list__link"
              :to="entry.location"
              :title="entry.name"
              :aria-disabled="entry.location ? undefined : true"
            >
              <span class="file-list__identity">
                <span
                  class="file-list__icon"
                  :class="{ 'file-list__icon--file': entry.kind === 'document' }"
                >
                  <SvgIcon
                    :name="entry.kind === 'document' ? 'page' : 'folder'"
                    :size="view === 'grid' ? 48 : 20"
                  />
                </span>
                <span class="file-list__info">
                  <span class="file-list__name">{{ entry.name }}</span>
                  <span v-if="entry.description" class="file-list__description">{{
                    entry.description
                  }}</span>
                </span>
              </span>
              <span class="file-list__type">{{ entry.typeLabel }}</span>
              <time class="file-list__time" :datetime="entry.updated_at || undefined">{{
                formatTime(entry.updated_at)
              }}</time>
            </component>
            <button
              class="file-list__icon-button file-list__menu"
              type="button"
              :aria-label="entry.name + '的更多操作'"
              title="更多操作"
              aria-haspopup="menu"
              :aria-expanded="isMenuOpen(entry)"
              :disabled="busy"
              @click.stop="openMenu($event, entry, true)"
              @keydown.down.prevent.stop="openMenu($event, entry, true)"
            >
              <SvgIcon name="more-16" :size="16" />
            </button>
          </li>
        </ul>
        <nav v-if="pageCount > 1" class="file-list__pagination" aria-label="目录分页">
          <button
            class="file-list__button"
            type="button"
            :disabled="page <= 1 || busy"
            @click="$emit('page', page - 1)"
          >
            上一页
          </button>
          <span>第 {{ page }} / {{ pageCount }} 页 · 每页 {{ pageSize }} 项</span>
          <button
            class="file-list__button"
            type="button"
            :disabled="page >= pageCount || busy"
            @click="$emit('page', page + 1)"
          >
            下一页
          </button>
        </nav>
      </template>
    </section>
    <footer class="file-list__footer" role="status">
      {{ loading ? loadingLabel : error ? errorTitle : `${total} 项` }}
    </footer>
    <VoexContextMenu
      v-if="contextMenu"
      v-model="menuOpen"
      :items="menuItems"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :trigger="contextMenu.trigger"
      :label="(contextEntry?.name || '文件') + '的操作'"
      @select="selectMenu"
    />
  </div>
</template>

<script setup lang="ts" generic="T extends FileListEntry">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import SvgIcon from '@/components/SvgIcon.vue';
import {
  VoexContextMenu,
  type ContextMenuItem,
  type ContextMenuOption,
} from '@/plugins/context-menu';
import { formatTime } from '@/utils/workspace';
import type { FileListEntry } from './types';

const props = withDefaults(
  defineProps<{
    entries: T[];
    total: number;
    loading: boolean;
    busy?: boolean;
    error?: string;
    menu: (entry: T) => ContextMenuItem[];
    label?: string;
    loadingLabel?: string;
    refreshLabel?: string;
    errorTitle?: string;
    emptyTitle?: string;
    emptyDescription?: string;
    emptyIcon?: string;
    timeLabel?: string;
    typeLabel?: string;
    page?: number;
    pageCount?: number;
    pageSize?: number;
  }>(),
  {
    busy: false,
    error: '',
    label: '目录内容',
    loadingLabel: '正在加载目录…',
    refreshLabel: '刷新目录',
    errorTitle: '无法加载目录',
    emptyTitle: '此目录为空',
    emptyDescription: '',
    emptyIcon: 'folder-open',
    timeLabel: '修改时间',
    typeLabel: '类型',
    page: 1,
    pageCount: 1,
    pageSize: 48,
  }
);
const emit = defineEmits<{
  refresh: [];
  page: [value: number];
  action: [value: string, entry: T, trigger: HTMLElement | null];
}>();
const route = useRoute();
const contentElement = ref<HTMLElement>();
let refreshTrigger: HTMLElement | null = null;
let refreshLocation = '';
const view = ref<'grid' | 'list'>('grid');
const viewModes = [
  { value: 'grid', label: '网格布局' },
  { value: 'list', label: '列表布局' },
] as const;
try {
  if (localStorage.getItem('voex-desktop-view') === 'list') view.value = 'list';
} catch {
  /* Browsing remains available when storage is restricted. */
}
const menuOpen = ref(false);
const contextMenu = shallowRef<{
  key: string;
  kind: string;
  x: number;
  y: number;
  trigger: HTMLElement | null;
} | null>(null);
const contextEntry = computed(() =>
  props.entries.find(
    (entry) => entry.key === contextMenu.value?.key && entry.kind === contextMenu.value.kind
  )
);
const menuItems = computed(() => (contextEntry.value ? props.menu(contextEntry.value) : []));

function setView(value: 'grid' | 'list') {
  view.value = value;
  try {
    localStorage.setItem('voex-desktop-view', value);
  } catch {
    /* Keep the in-memory preference. */
  }
}

function refresh(event: MouseEvent) {
  if (props.loading || props.busy) return;
  refreshTrigger = event.currentTarget as HTMLElement;
  refreshLocation = route.fullPath;
  emit('refresh');
}
function isMenuOpen(entry: T) {
  return (
    menuOpen.value && contextMenu.value?.key === entry.key && contextMenu.value.kind === entry.kind
  );
}
function openMenu(event: MouseEvent | KeyboardEvent, entry: T, dropdown = false) {
  if (props.loading || props.busy) return;
  const row = event.currentTarget as HTMLElement;
  if (
    dropdown &&
    event.type === 'click' &&
    isMenuOpen(entry) &&
    contextMenu.value?.trigger === row
  ) {
    menuOpen.value = false;
    return;
  }
  const target =
    event.target instanceof Element ? event.target.closest<HTMLElement>('a, button') : null;
  const trigger =
    target && row.contains(target) && !target.matches(':disabled')
      ? target
      : row.querySelector<HTMLElement>('a, button');
  const rect = (trigger ?? row).getBoundingClientRect();
  const keyboard = event instanceof KeyboardEvent || (event.clientX === 0 && event.clientY === 0);
  contextMenu.value = {
    key: entry.key,
    kind: entry.kind,
    x: dropdown || keyboard ? rect.left : event.clientX,
    y: dropdown ? rect.bottom + 4 : keyboard ? rect.bottom : event.clientY,
    trigger,
  };
  menuOpen.value = true;
}
function handleEntryKeydown(event: KeyboardEvent, entry: T) {
  if (
    event.isComposing ||
    (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  openMenu(event, entry);
}
function selectMenu(item: ContextMenuOption) {
  if (!contextEntry.value || props.loading || props.busy || item.disabled) return;
  emit('action', item.value, contextEntry.value, contextMenu.value?.trigger ?? null);
}
function focusEntry(key?: string) {
  const rows = contentElement.value?.querySelectorAll<HTMLElement>('[data-entry-key]');
  const row = Array.from(rows ?? []).find((entry) => entry.dataset.entryKey === key);
  (row?.querySelector<HTMLElement>('a, button') ?? contentElement.value)?.focus({
    preventScroll: true,
  });
}
watch(
  [() => route.fullPath, view, () => props.loading, () => props.busy, () => props.entries],
  () => {
    menuOpen.value = false;
  }
);
defineExpose({ focusEntry });

watch(
  () => props.loading,
  async (loading) => {
    if (loading || !refreshTrigger) return;
    const trigger = refreshTrigger;
    refreshTrigger = null;
    await nextTick();
    if (route.fullPath !== refreshLocation || document.activeElement !== document.body) return;
    if (trigger.isConnected && !trigger.matches(':disabled'))
      trigger.focus({ preventScroll: true });
    else focusEntry();
  }
);
</script>

<style scoped lang="stylus">
.file-list
  display flex
  flex 1
  flex-direction column
  min-width 0
  min-height 0
  container-type inline-size
  color var(--color-text-secondary)
  font-size 13px
  line-height 20px
  &__toolbar
    display flex
    flex-shrink 0
    align-items flex-start
    gap 12px
    min-height 44px
    padding 8px
  &__navigation
    flex 1
    min-width 0
    min-height 28px
  &__tools, &__view
    display flex
    align-items center
    flex-shrink 0
    gap 6px
  &__icon-button
    display inline-flex
    align-items center
    justify-content center
    width 28px
    height 28px
    flex-shrink 0
    border-radius var(--border-radius-item-s)
    color var(--color-text-tertiary)
    cursor pointer
    &:hover:not(:disabled), &--selected
      background var(--color-bg-quaternary)
      color var(--color-text-primary)
    &:active:not(:disabled)
      background var(--color-bg-translucent)
    &:disabled
      cursor not-allowed
      opacity .4
  &__tool
    border 1px solid var(--color-border-translucent-strong)
    border-radius 50%
    background var(--color-bg-translucent)
  &__icon-button:focus-visible, &__link:focus-visible, &__button:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset -2px
  &__content
    flex 1
    min-height 0
    padding 24px 32px 32px
    overflow-y auto
    overscroll-behavior contain
    scrollbar-gutter stable
  &__inner
    width 100%
    max-width 800px
  &__entries
    margin 0
    padding 0
    list-style none
  &__entry
    position relative
    min-width 0
    overflow hidden
  &__link
    min-width 0
    color inherit
    text-decoration none
    &[href]
      cursor pointer
      &:hover
        color var(--color-text-primary)
      &:active
        background var(--color-bg-translucent)
  &__identity, &__info
    min-width 0
  &__icon
    display flex
    align-items center
    justify-content center
    flex-shrink 0
    color var(--color-blue)
    &--file
      color var(--color-text-tertiary)
  &__name
    display block
    overflow hidden
    color var(--color-text-primary)
    text-overflow ellipsis
    white-space nowrap
    font-size 12px
    line-height 18px
  &__description
    display block
    margin-top 4px
    color var(--color-text-tertiary)
    font-size 11px
    overflow-wrap anywhere
  &__time, &__type
    color var(--color-text-tertiary)
    font-size 12px
    white-space nowrap
  &__entry--unavailable .file-list__name
    color var(--color-text-tertiary)
  &__entries--grid
    display grid
    grid-template-columns repeat(auto-fill, minmax(180px, 1fr))
    gap 14px
    .file-list__entry
      border 1px solid var(--color-border-translucent-strong)
      border-radius var(--border-radius-item-m)
      background var(--color-bg-translucent)
      &:hover, &--context
        border-color var(--color-border-secondary)
    .file-list__link
      display block
      height 100%
    .file-list__icon
      min-height 82px
      background var(--color-bg-secondary)
    .file-list__info
      display block
      padding 10px 12px 4px
    .file-list__time
      display block
      padding 0 12px 10px
    .file-list__type
      display none
    .file-list__menu
      position absolute
      top 8px
      right 8px
  &__heading
    display grid
    grid-template-columns minmax(0, 1fr) 64px 144px 28px
    gap 16px
    align-items center
    min-height 32px
    padding 0 12px
    border-bottom 1px solid var(--color-border-translucent)
    color var(--color-text-quaternary)
    font-size 11px
  &__entries--list
    .file-list__entry
      display grid
      grid-template-columns minmax(0, 1fr) 28px
      align-items center
      gap 16px
      padding 0 12px
      min-height 58px
      border-bottom 1px solid var(--color-border-translucent)
      &:hover, &--context
        background var(--color-bg-translucent)
    .file-list__link
      display grid
      grid-template-columns minmax(0, 1fr) 64px 144px
      align-items center
      gap 16px
      padding 10px 0
    .file-list__identity
      display flex
      align-items center
      gap 12px
  &__state
    display flex
    flex-direction column
    align-items center
    justify-content center
    margin 0 auto
    gap 12px
    min-height 280px
    padding 32px 16px
    text-align center
    color var(--color-text-tertiary)
    h2
      margin 0
      color var(--color-text-secondary)
      font-size 14px
      font-weight 500
    p
      max-width 360px
      overflow-wrap anywhere
  &__state-actions, &__pagination
    display flex
    flex-wrap wrap
    align-items center
    justify-content center
    gap 8px
  &__pagination
    margin-top 28px
  &__button
    display inline-flex
    align-items center
    justify-content center
    min-height 30px
    padding 4px 12px
    border 1px solid var(--color-border-translucent-strong)
    border-radius var(--border-radius-item-s)
    background var(--color-bg-translucent)
    color var(--color-text-secondary)
    font-size 12px
    cursor pointer
    &:hover:not(:disabled)
      background var(--color-bg-quaternary)
      color var(--color-text-primary)
    &:active:not(:disabled)
      filter brightness(.94)
    &:disabled
      cursor not-allowed
      opacity .4
  &__footer
    display flex
    flex-shrink 0
    align-items center
    justify-content flex-end
    min-height 32px
    padding 4px 12px
    color var(--color-text-quaternary)
    font-size 12px
  &__spinner
    width 22px
    height 22px
    border 2px solid var(--color-border-primary)
    border-top-color var(--color-text-tertiary)
    border-radius 50%
    animation file-list-spin .8s linear infinite
@container (max-width: 640px)
  .file-list__content
    padding 16px 12px 24px
  .file-list__heading
    grid-template-columns minmax(0, 1fr) 130px 28px
  .file-list__entries--list .file-list__link
    grid-template-columns minmax(0, 1fr) 130px
  .file-list__entries--list .file-list__type, .file-list__heading .file-list__type
    display none
@container (max-width: 440px)
  .file-list__entries--grid
    grid-template-columns repeat(2, minmax(0, 1fr))
    gap 10px
    .file-list__time
      white-space normal
  .file-list__heading
    grid-template-columns minmax(0, 1fr) 28px
  .file-list__entries--list .file-list__link
    grid-template-columns minmax(0, 1fr)
  .file-list__entries--list .file-list__time, .file-list__heading .file-list__time
    display none
@keyframes file-list-spin
  to
    transform rotate(360deg)
@media (prefers-reduced-motion: reduce)
  .file-list__spinner
    animation none
</style>
