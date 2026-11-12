<template>
  <aside class="history-panel" :class="{ 'history-panel--mobile': mobile }">
    <div class="history-panel__header">
      <h2 class="history-panel__title">
        <SvgIcon name="clock-outline" size="18px" />
        {{ viewMode === 'preview' ? '版本预览' : '历史版本' }}
      </h2>
      <button
        type="button"
        class="edit-page__icon-button"
        title="关闭历史版本"
        aria-label="关闭历史版本"
        @click="emit('close')"
      >
        <SvgIcon name="close" :size="18" />
      </button>
    </div>

    <!-- 版本预览：只读渲染，可与当前正文对比 -->
    <template v-if="viewMode === 'preview' && viewing">
      <div class="history-panel__preview-bar">
        <button type="button" class="history-panel__link" @click="backToList">← 返回列表</button>
        <span class="history-panel__preview-title">
          {{ viewing.label || kindLabels[viewing.kind] }} · {{ formatTime(viewing.created_at) }}
        </span>
        <button type="button" class="history-panel__tool" @click="toggleDiff">
          {{ diffMode ? '查看原文' : '与当前对比' }}
        </button>
        <button
          type="button"
          class="history-panel__tool history-panel__tool--primary"
          :disabled="busy || !canWrite"
          :title="canWrite ? '恢复此版本' : '恢复需要文件编辑权限'"
          @click="handleRestore(viewing)"
        >
          恢复此版本
        </button>
      </div>
      <p v-if="previewError" class="history-panel__error" role="alert">
        {{ previewError }}
        <button type="button" class="history-panel__link" @click="openPreview(viewing)">
          重新加载
        </button>
      </p>
      <p v-else-if="!previewReady" class="history-panel__status" role="status">
        {{ diffMode ? '正在计算文档差异…' : '正在加载版本内容…' }}
      </p>
      <div v-if="diffMode" class="history-panel__legend">
        <span class="history-panel__legend-added">＋ 新增</span>
        <span class="history-panel__legend-removed">− 删除（删除线）</span>
        <span v-if="previewReady">{{ differences }} 处差异</span>
      </div>
      <div
        class="history-panel__preview"
        :class="{ 'history-panel__preview--loading': !previewReady }"
        :aria-busy="!previewReady && !previewError"
        :inert="!previewReady"
        tabindex="0"
        aria-label="版本内容预览，只读"
      >
        <MilkdownProvider :key="previewKey">
          <MilkdownEditor
            :default-value="viewing.content"
            :document-key="documentKey"
            :attachments="attachments"
            :load-image="loadImage"
            :on-preview-attachment="onPreviewAttachment"
            :diff-after="diffMode ? currentContent : undefined"
            readonly
            :show-toolbar="false"
            :show-outline="false"
            :show-minimap="false"
            :code-mirror-enabled="false"
            :allow-attachments="false"
            @ready="previewReady = true"
            @diff-ready="onDiffReady"
            @load-error="onPreviewError"
          />
        </MilkdownProvider>
      </div>
    </template>

    <!-- 时间线列表 -->
    <template v-else>
      <div class="history-panel__actions">
        <template v-if="naming">
          <input
            v-model="labelInput"
            class="history-panel__label-input"
            type="text"
            maxlength="255"
            :disabled="busy || !canWrite"
            placeholder="版本标签（可留空）"
            @keydown.enter.prevent="saveCurrent"
            @keydown.esc.prevent="naming = false"
          />
          <button
            type="button"
            class="history-panel__tool history-panel__tool--primary"
            :disabled="busy || !canWrite"
            @click="saveCurrent"
          >
            保存
          </button>
          <button
            type="button"
            class="history-panel__tool"
            :disabled="busy"
            @click="naming = false"
          >
            取消
          </button>
        </template>
        <button
          v-else
          type="button"
          class="history-panel__tool history-panel__tool--primary"
          :disabled="busy || !canWrite"
          :title="canWrite ? '把当前正文保存为命名版本' : '保存版本需要文件编辑权限'"
          @click="naming = true"
        >
          保存当前版本
        </button>
      </div>
      <p v-if="listError" class="history-panel__error" role="alert">
        {{ listError }}
        <button type="button" class="history-panel__link" @click="loadFirst">重新加载</button>
      </p>
      <div class="history-panel__list">
        <div v-if="loadingList && !items.length" class="history-panel__status" role="status">
          正在加载历史版本…
        </div>
        <div v-else-if="!items.length" class="history-panel__empty">
          <SvgIcon name="clock-outline" size="40px" class="history-panel__empty-icon" />
          <p>暂无历史版本；编辑过程中会自动记录，也可以点击上方「保存当前版本」。</p>
        </div>
        <section v-for="group in groups" :key="group.label" class="history-panel__group">
          <h3 class="history-panel__group-label">{{ group.label }}</h3>
          <div v-for="item in group.items" :key="item.id" class="history-panel__item">
            <div class="history-panel__item-info">
              <span class="history-panel__item-title">
                <span class="history-panel__kind">{{ kindLabels[item.kind] }}</span>
                <span v-if="item.label" class="history-panel__label" :title="item.label">
                  {{ item.label }}
                </span>
              </span>
              <span class="history-panel__meta">
                {{ formatTime(item.created_at) }} · {{ creatorName(item) }} · 修订
                {{ item.revision }}
              </span>
            </div>
            <div class="history-panel__item-actions">
              <button
                type="button"
                class="history-panel__tool"
                title="预览此版本"
                @click="openPreview(item)"
              >
                预览
              </button>
              <button
                type="button"
                class="history-panel__tool"
                :disabled="busy || !canWrite"
                :title="canWrite ? '恢复此版本' : '恢复需要文件编辑权限'"
                @click="handleRestore(item)"
              >
                恢复
              </button>
              <button
                v-if="item.kind === 'manual'"
                type="button"
                class="history-panel__tool history-panel__tool--danger"
                title="删除此命名版本"
                :disabled="busy || !canWrite"
                @click="handleDelete(item)"
              >
                删除
              </button>
            </div>
          </div>
        </section>
        <button
          v-if="nextCursor"
          type="button"
          class="history-panel__more"
          :disabled="loadingList"
          @click="loadMore"
        >
          {{ loadingList ? '正在加载…' : '加载更早的版本' }}
        </button>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { MilkdownProvider } from '@milkdown/vue';
import SvgIcon from '@/components/SvgIcon.vue';
import MilkdownEditor from '@/views/edit/milkdown/MilkdownEditor.vue';
import { useConfirm } from '@/composables/useConfirm';
import { useNotificationStore } from '@/stores/notification';
import { MessageType } from '@/constant/status';
import { errorMessage } from '@/utils/error';
import type { FileInfo } from '@/service/api/document-api';
import {
  createDocumentVersion,
  deleteDocumentVersion,
  getDocumentVersion,
  listDocumentVersions,
  restoreDocumentVersion,
  type DocumentVersionDetail,
  type DocumentVersionInfo,
  type DocumentVersionKind,
} from '@/service/api/document-history-api';

const props = defineProps<{
  documentKey: string;
  canWrite: boolean;
  mobile: boolean;
  /** 当前正文（实时编辑内容），用于版本对比。 */
  currentContent: string;
  active: boolean;
  ensureSaved: () => Promise<void>;
  attachments: FileInfo[];
  loadImage: (hash: string, signal: AbortSignal, documentKey?: string) => Promise<Blob>;
  onPreviewAttachment: (file: FileInfo) => void;
}>();

const emit = defineEmits<{
  close: [];
  restored: [];
}>();

const PAGE_SIZE = 20;
const kindLabels: Record<DocumentVersionKind, string> = {
  auto: '自动',
  manual: '命名',
  backup: '恢复前备份',
};

const { confirm } = useConfirm();
const notification = useNotificationStore();

const items = ref<DocumentVersionInfo[]>([]);
const nextCursor = ref('');
const loadingList = ref(false);
const listError = ref('');
const busy = ref(false);
const naming = ref(false);
const labelInput = ref('');

const viewMode = ref<'list' | 'preview'>('list');
const viewing = ref<DocumentVersionDetail | null>(null);
const previewReady = ref(false);
const previewError = ref('');
const diffMode = ref(false);
const differences = ref(0);

const previewKey = computed(
  () => `${props.documentKey}:${viewing.value?.id ?? 0}:${diffMode.value ? 'diff' : 'plain'}`
);

let disposed = false;
let documentGeneration = 0;
let listRequest = 0;
let previewRequest = 0;

function isCurrentDocument(key: string, generation: number): boolean {
  return !disposed && key === props.documentKey && generation === documentGeneration;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function groupLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

const groups = computed(() => {
  const map = new Map<string, DocumentVersionInfo[]>();
  for (const item of items.value) {
    const label = groupLabel(item.created_at);
    const list = map.get(label) ?? [];
    list.push(item);
    map.set(label, list);
  }
  return [...map.entries()].map(([label, list]) => ({ label, items: list }));
});

function creatorName(item: DocumentVersionInfo): string {
  if (item.creator?.name) return item.creator.name;
  return item.created_by_anonymous ? '匿名用户' : '未记录';
}

async function loadFirst() {
  const key = props.documentKey;
  if (!key || !props.active || disposed) return;
  const generation = documentGeneration;
  const request = ++listRequest;
  const isCurrent = () => isCurrentDocument(key, generation) && request === listRequest;
  loadingList.value = true;
  listError.value = '';
  try {
    const result = await listDocumentVersions(key, PAGE_SIZE);
    if (!isCurrent()) return;
    items.value = result.items;
    nextCursor.value = result.next_cursor;
  } catch (cause) {
    if (!isCurrent()) return;
    listError.value = errorMessage(cause, '历史版本加载失败');
  } finally {
    if (isCurrent()) loadingList.value = false;
  }
}

async function loadMore() {
  if (!nextCursor.value || loadingList.value || !props.active || disposed) return;
  const key = props.documentKey;
  const generation = documentGeneration;
  const request = ++listRequest;
  const isCurrent = () => isCurrentDocument(key, generation) && request === listRequest;
  const cursor = Number(nextCursor.value);
  loadingList.value = true;
  listError.value = '';
  try {
    const result = await listDocumentVersions(key, PAGE_SIZE, cursor);
    if (!isCurrent()) return;
    items.value = [...items.value, ...result.items];
    nextCursor.value = result.next_cursor;
  } catch (cause) {
    if (!isCurrent()) return;
    listError.value = errorMessage(cause, '历史版本加载失败');
  } finally {
    if (isCurrent()) loadingList.value = false;
  }
}

async function openPreview(item: DocumentVersionInfo) {
  if (!props.active || disposed) return;
  const key = props.documentKey;
  const generation = documentGeneration;
  backToList();
  const request = previewRequest;
  const isCurrent = () => isCurrentDocument(key, generation) && request === previewRequest;
  try {
    const detail = await getDocumentVersion(key, item.id);
    if (!isCurrent()) return;
    viewing.value = detail;
    viewMode.value = 'preview';
  } catch (cause) {
    if (!isCurrent()) return;
    notification.show(errorMessage(cause, '版本内容加载失败'), 'error', 0);
  }
}

function backToList() {
  previewRequest++;
  viewMode.value = 'list';
  viewing.value = null;
  previewReady.value = false;
  previewError.value = '';
  diffMode.value = false;
  differences.value = 0;
}

function toggleDiff() {
  if (!viewing.value) return;
  diffMode.value = !diffMode.value;
  previewReady.value = false;
  previewError.value = '';
  differences.value = 0;
}

function onDiffReady(count: number) {
  previewReady.value = true;
  differences.value = count;
}

function onPreviewError(message: string) {
  previewReady.value = false;
  previewError.value = message || '文档预览加载失败';
}

async function saveCurrent() {
  if (busy.value || !props.canWrite || !props.active || disposed) return;
  const key = props.documentKey;
  const generation = documentGeneration;
  const label = labelInput.value.trim() || undefined;
  busy.value = true;
  try {
    await props.ensureSaved();
    if (!isCurrentDocument(key, generation) || !props.canWrite) return;
    await createDocumentVersion(key, label);
    if (!isCurrentDocument(key, generation)) return;
    notification.show('已保存当前版本', 'success');
    naming.value = false;
    labelInput.value = '';
    await loadFirst();
  } catch (cause) {
    if (!isCurrentDocument(key, generation)) return;
    notification.show(errorMessage(cause, '保存版本失败'), 'error', 0);
  } finally {
    if (isCurrentDocument(key, generation)) busy.value = false;
  }
}

async function handleRestore(item: DocumentVersionInfo) {
  if (busy.value || !props.canWrite || !props.active || disposed) return;
  const key = props.documentKey;
  const generation = documentGeneration;
  const target = item.label ? `「${item.label}」` : formatTime(item.created_at);
  busy.value = true;
  try {
    const accepted = await confirm({
      type: MessageType.WARNING,
      title: '恢复历史版本',
      content: `恢复到 ${target} 的版本？当前内容会先保存为历史版本。`,
      confirmText: '恢复',
    });
    if (!accepted || !isCurrentDocument(key, generation) || !props.canWrite) return;
    await restoreDocumentVersion(key, item.id);
    if (!isCurrentDocument(key, generation)) return;
    notification.show('已恢复该版本', 'success');
    backToList();
    emit('restored');
    if (isCurrentDocument(key, generation)) await loadFirst();
  } catch (cause) {
    if (!isCurrentDocument(key, generation)) return;
    notification.show(errorMessage(cause, '恢复失败'), 'error', 0);
  } finally {
    if (isCurrentDocument(key, generation)) busy.value = false;
  }
}

async function handleDelete(item: DocumentVersionInfo) {
  if (busy.value || !props.canWrite || !props.active || disposed) return;
  const key = props.documentKey;
  const generation = documentGeneration;
  busy.value = true;
  try {
    const accepted = await confirm({
      type: MessageType.WARNING,
      title: '删除命名版本',
      content: `删除版本${item.label ? `「${item.label}」` : ''}？此操作不可撤销。`,
      confirmText: '删除',
    });
    if (!accepted || !isCurrentDocument(key, generation) || !props.canWrite) return;
    await deleteDocumentVersion(key, item.id);
    if (isCurrentDocument(key, generation)) await loadFirst();
  } catch (cause) {
    if (!isCurrentDocument(key, generation)) return;
    notification.show(errorMessage(cause, '删除版本失败'), 'error', 0);
  } finally {
    if (isCurrentDocument(key, generation)) busy.value = false;
  }
}

watch(
  () => props.documentKey,
  () => {
    documentGeneration++;
    listRequest++;
    backToList();
    items.value = [];
    nextCursor.value = '';
    loadingList.value = false;
    listError.value = '';
    busy.value = false;
    naming.value = false;
    labelInput.value = '';
  },
  { immediate: true, flush: 'sync' }
);

watch(
  [() => props.active, () => props.documentKey],
  ([active, key]) => {
    if (active && key) {
      void loadFirst();
    } else {
      listRequest++;
      loadingList.value = false;
      backToList();
    }
  },
  { immediate: true, flush: 'sync' }
);

onBeforeUnmount(() => {
  disposed = true;
  documentGeneration++;
  listRequest++;
  previewRequest++;
});
</script>

<style scoped lang="stylus">
.history-panel
  display flex
  flex-direction column
  width 100%
  height 100%
  min-width 0
  min-height 0

  &__header
    display flex
    align-items center
    gap 8px
    min-height 56px
    padding 8px 14px
    flex-shrink 0

  &__title
    display flex
    align-items center
    gap 8px
    flex 1
    font-size 14px
    font-weight 600
    color var(--color-text-primary)
    margin 0

  &__actions
    display flex
    align-items center
    gap 8px
    padding 8px 14px
    flex-shrink 0

  &__label-input
    flex 1
    min-width 0
    height 32px
    padding 0 10px
    border 1px solid var(--color-border, rgba(128, 128, 128, .3))
    border-radius 8px
    background var(--color-bg-secondary)
    color var(--color-text-primary)
    font-size 13px

    &:focus
      outline 2px solid var(--color-accent-tint)
      outline-offset -1px

  &__tool
    display inline-flex
    align-items center
    justify-content center
    gap 4px
    height 30px
    padding 0 10px
    border 0
    border-radius 8px
    background var(--color-bg-secondary)
    color var(--color-text-primary)
    font-size 12px
    cursor pointer
    white-space nowrap

    &:hover:not(:disabled)
      background var(--color-bg-tertiary)

    &:disabled
      opacity .45
      cursor not-allowed

    &--primary
      background var(--color-accent-tint)
      font-weight 600

    &--danger
      color #d5504c

  &__link
    border 0
    background none
    padding 0
    color var(--color-accent, #4a7dbd)
    font-size 12px
    cursor pointer
    text-decoration underline

  &__error
    margin 0
    padding 8px 14px
    color #d5504c
    font-size 12px

  &__status
    margin 0
    padding 12px 14px
    color var(--color-text-secondary, rgba(128, 128, 128, .9))
    font-size 12px

  &__list
    flex 1
    min-height 0
    overflow-y auto
    padding 0 14px 12px

  &__empty
    display flex
    flex-direction column
    align-items center
    gap 12px
    padding 32px 12px
    text-align center
    color var(--color-text-secondary, rgba(128, 128, 128, .9))
    font-size 12px

  &__empty-icon
    opacity .5

  &__group
    margin 12px 0 0

  &__group-label
    position sticky
    top 0
    margin 0 0 6px
    padding 4px 0
    background var(--color-bg-primary, #fff)
    color var(--color-text-secondary, rgba(128, 128, 128, .9))
    font-size 12px
    font-weight 600

  &__item
    display flex
    align-items center
    gap 8px
    padding 8px
    border-radius 8px

    &:hover
      background var(--color-bg-secondary)

  &__item-info
    display flex
    flex-direction column
    gap 2px
    flex 1
    min-width 0

  &__item-title
    display flex
    align-items center
    gap 6px
    min-width 0

  &__kind
    flex-shrink 0
    padding 1px 6px
    border-radius 6px
    background var(--color-bg-tertiary)
    color var(--color-text-secondary, rgba(128, 128, 128, .9))
    font-size 11px

  &__label
    overflow hidden
    text-overflow ellipsis
    white-space nowrap
    color var(--color-text-primary)
    font-size 13px
    font-weight 600

  &__meta
    overflow hidden
    text-overflow ellipsis
    white-space nowrap
    color var(--color-text-secondary, rgba(128, 128, 128, .9))
    font-size 11px

  &__item-actions
    display flex
    align-items center
    gap 4px
    flex-shrink 0

  &__more
    display block
    width 100%
    margin 12px 0 0
    padding 8px
    border 0
    border-radius 8px
    background var(--color-bg-secondary)
    color var(--color-text-primary)
    font-size 12px
    cursor pointer

    &:hover:not(:disabled)
      background var(--color-bg-tertiary)

    &:disabled
      opacity .45
      cursor not-allowed

  &__preview-bar
    display flex
    align-items center
    gap 8px
    padding 8px 14px
    flex-shrink 0

  &__preview-title
    flex 1
    min-width 0
    overflow hidden
    text-overflow ellipsis
    white-space nowrap
    color var(--color-text-secondary, rgba(128, 128, 128, .9))
    font-size 12px

  &__legend
    display flex
    align-items center
    gap 10px
    padding 4px 14px
    color var(--color-text-secondary, rgba(128, 128, 128, .9))
    font-size 11px

  &__legend-added
    color #2f7d4f

  &__legend-removed
    color #d5504c

  &__preview
    flex 1
    min-height 0
    overflow-y auto
    padding 0 14px 14px

    &--loading
      opacity .5

  &--mobile
    width 100%
    height 100%
    min-width 0
    flex 1
    border 0

    .history-panel__tool
      height 36px
      padding 0 12px
</style>
