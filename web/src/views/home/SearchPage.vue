<template>
  <section class="search-page" aria-label="文档搜索">
    <header class="search-page__header"><h1 class="search-page__title">搜索</h1></header>
    <div class="search-page__search">
      <SvgIcon class="search-page__search-icon" name="search" :size="14" />
      <input
        class="search-page__input"
        type="text"
        placeholder="搜索当前团队的文档名称与正文"
        aria-label="搜索文档"
        autocomplete="off"
        maxlength="100"
        :value="query"
        @input="updateQuery"
        @compositionstart="startComposition"
        @compositionend="endComposition"
        @keydown.enter="handleEnter"
      />
      <span class="search-page__hint">至少 2 个字符</span>
    </div>
    <FileList
      :entries="entries"
      :total="total"
      :loading="loading"
      :error="loadError"
      :menu="entryMenu"
      label="搜索结果及命中片段"
      loading-label="正在搜索…"
      refresh-label="重新搜索"
      error-title="搜索失败"
      :empty-title="emptyTitle"
      :empty-description="emptyDescription"
      empty-icon="search"
      type-label="所在项目"
      time-label="更新时间"
      :page="page"
      :page-count="pageCount"
      :page-size="pageSize"
      @refresh="load"
      @page="changePage"
      @action="selectEntryMenu"
    >
      <template #navigation
        ><p class="search-page__description">
          在「{{ currentTeam?.name ?? '个人团队' }}」内搜索文档名称与正文，结果按匹配度排序。
        </p></template
      >
    </FileList>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FileList from '@/components/files/FileList.vue';
import type { FileListEntry } from '@/components/files/types';
import SvgIcon from '@/components/SvgIcon.vue';
import { searchDocuments, type SearchHit } from '@/service/api/search-api';
import type { ContextMenuItem } from '@/plugins/context-menu';
import { useTeamStore } from '@/stores/team';
import { desktopLocation } from '@/utils/workspace';
import { errorMessage } from '@/utils/error';

interface SearchEntry extends FileListEntry {
  hit: SearchHit;
}

const route = useRoute();
const router = useRouter();
const teams = useTeamStore();

const query = ref('');
const items = ref<SearchHit[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const loadError = ref('');
let controller: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let composing = false;
let compositionEndedAt = -Infinity;
let disposed = false;

const currentTeam = computed(() =>
  teams.resolve(typeof route.query.team_key === 'string' ? route.query.team_key : undefined)
);
const queryReady = computed(() => query.value.trim().length >= 2);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const emptyTitle = computed(() =>
  queryReady.value ? '没有找到匹配的文档' : '输入至少 2 个字符开始搜索'
);
const emptyDescription = computed(() =>
  queryReady.value
    ? '换个关键词试试，或确认文档在当前团队内。'
    : '在上方输入关键词，搜索当前团队内可查看或可编辑的文档名称与正文。'
);

const entries = computed<SearchEntry[]>(() =>
  items.value.map((hit) => ({
    key: hit.file_key,
    kind: 'document',
    name: hit.file_name,
    typeLabel: hit.project_name,
    description: hit.snippet,
    updated_at: hit.updated_at,
    location: { name: 'edit', params: { file_key: hit.file_key } },
    hit,
  }))
);

function entryMenu(): ContextMenuItem[] {
  return [
    { value: 'open', label: '打开', icon: 'page' },
    { value: 'directory', label: '跳转文件目录', icon: 'folder-open' },
  ];
}

function selectEntryMenu(value: string, selected: SearchEntry) {
  const entry = entries.value.find((item) => item.key === selected.key);
  if (!entry || loading.value) return;
  if (value === 'open' && entry.location) void router.push(entry.location);
  else if (value === 'directory') {
    const hit = entry.hit;
    void router.push(desktopLocation(hit.project_key, hit.folder_key, hit.team_key));
  }
}

function updateQuery(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  scheduleSearch();
}

function cancelPending() {
  clearTimeout(timer);
  controller?.abort();
  controller = undefined;
  loading.value = false;
}

function resetResults() {
  items.value = [];
  total.value = 0;
  loadError.value = '';
  page.value = 1;
}

function scheduleSearch() {
  cancelPending();
  resetResults();
  if (!composing && queryReady.value) {
    loading.value = true;
    timer = setTimeout(() => {
      loading.value = false;
      void load();
    }, 300);
  }
}

function startComposition() {
  composing = true;
  cancelPending();
}

function endComposition(event: CompositionEvent) {
  composing = false;
  compositionEndedAt = event.timeStamp;
  scheduleSearch();
}

function handleEnter(event: KeyboardEvent) {
  if (event.isComposing || composing || event.timeStamp - compositionEndedAt < 50) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  cancelPending();
  if (queryReady.value) void load();
}

function changePage(value: number) {
  if (loading.value || value < 1 || value > pageCount.value) return;
  page.value = value;
  void load();
}

async function load() {
  if (!queryReady.value) return;
  cancelPending();
  const request = new AbortController();
  controller = request;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await searchDocuments(
      {
        q: query.value.trim(),
        team_key: currentTeam.value?.team_key,
        limit: pageSize,
        offset: (page.value - 1) * pageSize,
      },
      request.signal
    );
    if (request.signal.aborted || disposed) return;
    items.value = result.items;
    total.value = result.total;
  } catch (cause) {
    if (!request.signal.aborted && !disposed)
      loadError.value = errorMessage(cause, '搜索失败，请重试');
  } finally {
    if (!request.signal.aborted && !disposed) loading.value = false;
  }
}

onMounted(() => {
  void teams.ensure();
});
watch(
  () => currentTeam.value?.team_key,
  () => {
    if (queryReady.value) {
      page.value = 1;
      void load();
    }
  }
);
watch(
  [loading, loadError, queryReady],
  () => {
    document.title =
      (loading.value ? '正在搜索' : loadError.value ? '搜索不可用' : '搜索') + ' · Voex';
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  disposed = true;
  cancelPending();
});
</script>

<style scoped lang="stylus">
.search-page
  position relative
  z-index 1
  display flex
  flex-direction column
  width 100%
  height 100%
  min-width 0
  min-height 0
  overflow hidden
  color var(--color-text-secondary)
  &__header
    display flex
    align-items center
    flex-shrink 0
    min-height 44px
    padding 0 18px
    border-bottom 1px solid var(--color-border-translucent)
  &__title
    margin 0
    font-size 12px
    font-weight 600
  &__search
    display flex
    align-items center
    gap 8px
    flex-shrink 0
    padding 10px 18px
    border-bottom 1px solid var(--color-border-translucent)
  &__search-icon
    flex-shrink 0
    color var(--color-text-tertiary)
  &__input
    flex 1
    min-width 0
    height 32px
    padding 0 10px
    border 1px solid var(--color-border-translucent-strong)
    border-radius 6px
    background var(--color-bg-secondary)
    color var(--color-text-primary)
    font-size 13px
    outline none
  &__hint
    flex-shrink 0
    color var(--color-text-tertiary)
    font-size 12px
  &__description
    margin 0
    padding 4px 10px
    color var(--color-text-tertiary)
    font-size 12px
    line-height 20px
    overflow-wrap anywhere
</style>
