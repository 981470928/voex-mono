<template>
  <section class="recent-page" aria-label="最近文件">
    <header class="recent-page__header"><h1 class="recent-page__title">最近文件</h1></header>
    <FileList
      ref="fileList"
      :entries="entries"
      :total="total"
      :loading="loading"
      :busy="!!busy"
      :error="loadError"
      :menu="entryMenu"
      label="最近查看的文件及当前访问权限"
      loading-label="正在加载最近文件…"
      refresh-label="刷新最近文件"
      error-title="最近文件加载失败"
      empty-title="还没有最近查看的文件"
      empty-description="从侧边栏选择项目并打开文件，或访问分享链接，查看记录会显示在这里。"
      empty-icon="clock-outline"
      time-label="最近查看"
      type-label="访问权限"
      @refresh="load"
      @action="selectEntryMenu"
    >
      <template #navigation
        ><p class="recent-page__description">
          最多保留最近 {{ limit }} 条查看记录，包含项目文件和分享文件。
        </p></template
      >
    </FileList>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FileList from '@/components/files/FileList.vue';
import type { FileListEntry } from '@/components/files/types';
import {
  queryRecentFiles,
  removeRecentFile,
  getRecentFileDetails,
  type RecentFile,
} from '@/service/api/recent-api';
import type { FileDetails } from '@/service/api/document-api';
import type { ContextMenuItem } from '@/plugins/context-menu';
import { useConfirm } from '@/composables/useConfirm';
import { useDialog } from '@/composables/useDialog';
import { ModalType } from '@/stores/modal';
import { useNotificationStore } from '@/stores/notification';
import { usePermissionStore } from '@/stores/permission';
import { useTeamStore } from '@/stores/team';
import { authUser } from '@/service/auth-session';
import { desktopLocation } from '@/utils/workspace';
import { errorMessage } from '@/utils/error';
import { MessageType } from '@/constant/status';

interface RecentEntry extends FileListEntry {
  file: RecentFile;
}
const route = useRoute();
const router = useRouter();
const { confirm } = useConfirm();
const notification = useNotificationStore();
const permission = usePermissionStore();
const teams = useTeamStore();
const items = ref<RecentFile[]>([]);
const total = ref(0);
const limit = 40;
const loading = ref(true);
const loadError = ref('');
const busy = ref('');
const fileList = ref<{ focusEntry: (key?: string) => void }>();
const shareOpen = ref(false);
const shareFile = ref({ key: '', name: '' });
useDialog(ModalType.SHARE_DIALOG, {
  visible: () => shareOpen.value,
  props: () => ({ fileKey: shareFile.value.key, fileName: shareFile.value.name }),
  onClose: () => {
    shareOpen.value = false;
  },
});
const detailsOpen = ref(false);
const detailsFile = ref({ key: '', name: '' });
useDialog(ModalType.FILE_DETAILS_DIALOG, {
  visible: () => detailsOpen.value,
  props: () => ({
    fileKey: detailsFile.value.key,
    fileName: detailsFile.value.name,
    source: 'recent',
    onResolved: applyDetails,
  }),
  onClose: () => {
    detailsOpen.value = false;
  },
});
let controller: AbortController | undefined;
let directoryController: AbortController | undefined;
let disposed = false;

const entries = computed<RecentEntry[]>(() =>
  items.value.map((file) => {
    const access = permission.recent(file);
    return {
      key: file.file_key,
      kind: 'document',
      name: file.file_name,
      typeLabel: access.read ? (access.write ? '可编辑' : '只读') : '不可访问',
      description: !access.read
        ? '权限已变更或分享已撤销'
        : access.directory
          ? '项目文件'
          : '分享文件',
      updated_at: file.viewed_at,
      location: access.read
        ? { name: access.directory ? 'edit' : 'recent-file', params: { file_key: file.file_key } }
        : undefined,
      file,
    };
  })
);

function entryMenu(entry: RecentEntry): ContextMenuItem[] {
  const access = permission.recent(entry.file);
  return [
    {
      value: 'open',
      label: '打开',
      icon: 'page',
      disabled: !access.read,
      description: !access.read ? '没有访问权限或分享已撤销' : undefined,
    },
    ...(access.write ? [{ value: 'share', label: '分享', icon: 'share' }] : []),
    ...(access.directory
      ? [{ value: 'directory', label: '跳转文件目录', icon: 'folder-open' }]
      : []),
    {
      value: 'details',
      label: '详细信息',
      icon: 'info',
      disabled: !access.details,
      description: !access.details ? '没有访问权限或分享已撤销' : undefined,
    },
    { separator: true },
    {
      value: 'remove-record',
      label: '删除记录',
      icon: 'trash',
      danger: true,
      disabled: !access.removeRecord,
    },
  ];
}

function selectEntryMenu(value: string, selected: RecentEntry) {
  const entry = entries.value.find((item) => item.key === selected.key);
  if (!entry || loading.value || busy.value) return;
  const access = permission.recent(entry.file);
  if (value === 'open' && access.read && entry.location) void router.push(entry.location);
  else if (value === 'share' && access.write) {
    shareFile.value = { key: entry.key, name: entry.name };
    shareOpen.value = true;
  } else if (value === 'remove-record' && access.removeRecord) void remove(entry.file);
  else if (value === 'directory' && access.directory) void openDirectory(entry.file);
  else if (value === 'details' && access.details) {
    detailsFile.value = { key: entry.key, name: entry.name };
    detailsOpen.value = true;
  }
}

function applyDetails(details: FileDetails) {
  items.value = items.value.map((file) =>
    file.file_key === details.file_key
      ? {
          ...file,
          file_name: details.file_name,
          access: details.access,
          permissions: details.permissions,
          path: details.path,
        }
      : file
  );
}

async function openDirectory(file: RecentFile) {
  if (busy.value || !permission.recent(file).directory) return;
  busy.value = file.file_key;
  const from = route.fullPath;
  const request = new AbortController();
  directoryController?.abort();
  directoryController = request;
  try {
    const details = await getRecentFileDetails(file.file_key, request.signal);
    if (request.signal.aborted || disposed || route.fullPath !== from) return;
    applyDetails(details);
    if (!permission.recent(details).directory || !details.path) {
      notification.show('你已没有此文件所属项目的访问权限', 'info');
      return;
    }
    const path = details.path;
    await router.push(desktopLocation(path.project_key, path.folder_key, path.team_key));
  } catch (cause) {
    if (!request.signal.aborted && !disposed && route.fullPath === from) {
      notification.show(errorMessage(cause, '无法打开文件目录，请重试'), 'error');
      await load();
    }
  } finally {
    busy.value = '';
    await nextTick();
    if (!disposed && route.fullPath === from && document.activeElement === document.body)
      fileList.value?.focusEntry(file.file_key);
  }
}

async function load() {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await queryRecentFiles(limit, request.signal);
    if (request.signal.aborted || disposed) return;
    items.value = result.items;
    total.value = result.total;
  } catch (cause) {
    if (!request.signal.aborted && !disposed)
      loadError.value = errorMessage(cause, '最近文件加载失败，请重试');
  } finally {
    if (!request.signal.aborted && !disposed) loading.value = false;
  }
}

async function remove(item: RecentFile) {
  if (busy.value || loading.value || !permission.recent(item).removeRecord) return;
  busy.value = item.file_key;
  const location = route.fullPath;
  try {
    const accepted = await confirm({
      type: MessageType.WARNING,
      title: '删除最近查看记录',
      content:
        '从最近文件中删除「' +
        item.file_name +
        '」的查看记录？原文件和附件会保留，再次打开文件后会重新记录。',
      confirmText: '删除记录',
    });
    if (!accepted || disposed || route.fullPath !== location) return;
    const result = await removeRecentFile(item.file_key);
    if (!result.success) throw new Error('删除记录失败，请重试');
    if (disposed) return;
    items.value = items.value.filter((entry) => entry.file_key !== item.file_key);
    notification.show('最近查看记录已删除', 'success');
    await load();
  } catch (cause) {
    if (!disposed) notification.show(errorMessage(cause, '删除记录失败，请重试'), 'error');
  } finally {
    busy.value = '';
    await nextTick();
    if (!disposed && route.fullPath === location) fileList.value?.focusEntry(item.file_key);
  }
}

onMounted(load);
watch([() => teams.projectRevision, () => authUser.value?.id], load);
watch(
  () => route.fullPath,
  () => directoryController?.abort()
);
watch(
  [loading, loadError],
  () => {
    document.title =
      (loading.value ? '正在加载最近文件' : loadError.value ? '最近文件不可用' : '最近文件') +
      ' · Voex';
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  disposed = true;
  controller?.abort();
  directoryController?.abort();
});
</script>

<style scoped lang="stylus">
.recent-page
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
  &__description
    margin 0
    padding 4px 10px
    color var(--color-text-tertiary)
    font-size 12px
    line-height 20px
    overflow-wrap anywhere
</style>
