<template>
  <main class="desktop">
    <header class="desktop__toolbar">
      <RouterLink
        class="desktop__project-link"
        :to="desktopLocation(projectKey)"
        :title="projectName"
        :aria-label="'返回项目：' + projectName"
        >{{ projectName }}</RouterLink
      >
      <button
        v-if="permission.project(tree?.project).manage"
        class="desktop__button"
        type="button"
        :disabled="loading || busy"
        @click="privilegesOpen = true"
      >
        项目权限
      </button>
    </header>
    <FileList
      ref="fileList"
      :entries="pageEntries"
      :total="entries.length"
      :loading="loading"
      :busy="busy || creating"
      :error="error"
      :menu="entryMenu"
      :page="page"
      :page-count="pageCount"
      :page-size="PAGE_SIZE"
      :empty-description="
        canWrite
          ? folderKey
            ? '创建一个文件，开始记录内容。'
            : '创建一个文件夹，开始整理内容。'
          : '当前目录没有可查看的内容。'
      "
      @refresh="load"
      @page="setPage"
      @action="selectEntryMenu"
    >
      <template #navigation>
        <nav class="desktop__breadcrumbs" aria-label="文件夹路径">
          <ol class="desktop__breadcrumb-list">
            <li
              v-for="(folder, index) in path"
              :key="folder.folder_key"
              class="desktop__breadcrumb-item"
            >
              <SvgIcon
                v-if="index"
                class="desktop__breadcrumb-separator"
                name="chevron-right"
                :size="12"
              />
              <span
                v-if="folder.folder_key === folderKey"
                class="desktop__breadcrumb desktop__breadcrumb--current"
                aria-current="page"
                ><SvgIcon v-if="!index" name="folder" :size="13" />{{ folder.name }}</span
              >
              <RouterLink
                v-else
                class="desktop__breadcrumb"
                :to="desktopLocation(projectKey, folder.folder_key)"
                ><SvgIcon v-if="!index" name="folder" :size="13" />{{ folder.name }}</RouterLink
              >
            </li>
          </ol>
        </nav>
      </template>
      <template #actions>
        <button
          v-if="canWrite"
          class="desktop__create"
          type="button"
          :title="folderKey ? '创建文件' : '创建文件夹'"
          :aria-label="folderKey ? '创建文件' : '创建文件夹'"
          :disabled="loading || busy || creating || !canWrite"
          @click="folderKey ? createFile() : createDirectory()"
        >
          <SvgIcon :name="folderKey ? 'page' : 'add'" :size="folderKey ? 14 : 18" />
        </button>
      </template>
      <template #error-actions>
        <RouterLink
          class="desktop__button"
          :to="folderKey ? desktopLocation(projectKey) : desktopLocation()"
          >{{ folderKey ? '返回项目' : '返回最近文件' }}</RouterLink
        >
      </template>
      <template v-if="canWrite" #empty-actions>
        <button
          class="desktop__button"
          type="button"
          :disabled="busy || creating"
          @click="folderKey ? createFile() : createDirectory()"
        >
          <SvgIcon name="add" :size="16" />{{ folderKey ? '创建文件' : '创建文件夹' }}
        </button>
      </template>
    </FileList>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import SvgIcon from '@/components/SvgIcon.vue';
import {
  getProjectTree,
  createFolder,
  renameFolder,
  deleteFolder,
  type ProjectTree,
} from '@/service/api/workspace-api';
import { updateDocument, deleteDocument } from '@/service/api/document-api';
import FileList from '@/components/files/FileList.vue';
import type { FileListEntry } from '@/components/files/types';
import { usePermissionStore, type ResourcePermissions } from '@/stores/permission';
import { desktopLocation as workspaceLocation, folderAncestors } from '@/utils/workspace';
import { errorMessage } from '@/utils/error';
import { useConfirm } from '@/composables/useConfirm';
import { useDialog } from '@/composables/useDialog';
import { useCreateDocument } from '@/composables/useCreateDocument';
import { useModalStore, ModalType } from '@/stores/modal';
import { useNotificationStore } from '@/stores/notification';
import { MessageType } from '@/constant/status';
import { useTeamStore } from '@/stores/team';
import type { ContextMenuItem } from '@/plugins/context-menu';

interface Entry extends FileListEntry {
  permissions: ResourcePermissions;
}

const route = useRoute();
const router = useRouter();
const modal = useModalStore();
const notification = useNotificationStore();
const teams = useTeamStore();
const permission = usePermissionStore();
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
const privilegesOpen = ref(false);
const currentTeam = computed(() =>
  teams.resolve(typeof route.query.team_key === 'string' ? route.query.team_key : undefined)
);
const { confirm } = useConfirm();
const { creating, openCreateDocument } = useCreateDocument();
const tree = ref<ProjectTree | null>(null);
useDialog(ModalType.PROJECT_PRIVILEGES_DIALOG, {
  visible: () => privilegesOpen.value && !!tree.value,
  props: () => ({ project: tree.value!.project, onSaved: permissionsSaved }),
  onClose: () => {
    privilegesOpen.value = false;
  },
});
useDialog(ModalType.FILE_DETAILS_DIALOG, {
  visible: () => detailsOpen.value,
  props: () => ({
    fileKey: detailsFile.value.key,
    fileName: detailsFile.value.name,
    source: 'project',
  }),
  onClose: () => {
    detailsOpen.value = false;
  },
});
const loading = ref(true);
const busy = ref(false);
const loadError = ref('');
const projectKey = computed(() =>
  typeof route.params.projectId === 'string' ? route.params.projectId || undefined : undefined
);
const folderKey = computed(() =>
  typeof route.params.folderId === 'string' ? route.params.folderId || undefined : undefined
);
const error = computed(() => {
  if (loadError.value) return loadError.value;
  if (loading.value || !folderKey.value) return '';
  if (!projectKey.value) return '目录地址缺少所属项目，请返回最近文件';
  if (tree.value && !tree.value.folders.some((folder) => folder.folder_key === folderKey.value))
    return '文件夹不存在或已被删除，请返回项目';
  return '';
});
const path = computed(() => folderAncestors(tree.value?.folders ?? [], folderKey.value));
const projectName = computed(() => tree.value?.project.name || '项目');
const title = computed(() =>
  folderKey.value ? path.value.at(-1)?.name || '文件夹' : projectName.value
);
const canWrite = computed(() => !error.value && permission.folder(tree.value?.project).write);
const PAGE_SIZE = 48;
const pageCount = computed(() => Math.max(1, Math.ceil(entries.value.length / PAGE_SIZE)));
const page = computed(() =>
  Math.min(pageCount.value, Math.max(1, Math.floor(Number(route.query.page)) || 1))
);
const pageEntries = computed(() =>
  entries.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
);
let controller: AbortController | undefined;
let generation = 0;
let active = true;

function desktopLocation(projectId?: string, folderId?: string): RouteLocationRaw {
  return workspaceLocation(projectId, folderId, currentTeam.value?.team_key);
}

const entries = computed<Entry[]>(() => {
  if (!tree.value) return [];
  const project = tree.value.project;
  return [
    ...tree.value.folders
      .filter((folder) => !folderKey.value && folder.parent_key === null)
      .map((folder): Entry => ({
        key: folder.folder_key,
        kind: 'folder',
        name: folder.name,
        typeLabel: '文件夹',
        updated_at: folder.updated_at,
        location: desktopLocation(projectKey.value, folder.folder_key),
        permissions: permission.folder(project),
      })),
    ...tree.value.documents
      .filter((doc) => doc.folder_key === folderKey.value)
      .map((doc): Entry => ({
        key: doc.file_key,
        kind: 'document',
        name: doc.file_name,
        typeLabel: '文件',
        updated_at: doc.updated_at,
        location: permission.document(doc, project).read
          ? { name: 'edit', params: { file_key: doc.file_key } }
          : undefined,
        permissions: permission.document(doc, project),
      })),
  ];
});

function entryMenu(entry: Entry): ContextMenuItem[] {
  const unavailable = loading.value || busy.value || creating.value;
  const reason = deleteReason(entry);
  return [
    {
      value: 'open',
      label: '打开',
      icon: entry.kind === 'folder' ? 'folder-open' : 'page',
      disabled: unavailable || !entry.permissions.read,
      description: !entry.permissions.read ? '没有访问权限' : undefined,
    },
    {
      value: 'rename',
      label: '重命名',
      icon: 'write',
      disabled: unavailable || !entry.permissions.rename,
      description: !entry.permissions.rename ? '没有编辑权限' : undefined,
    },
    ...(entry.kind === 'document' && entry.permissions.write
      ? [{ value: 'share', label: '分享', icon: 'share' }]
      : []),
    ...(entry.kind === 'document'
      ? [
          {
            value: 'details',
            label: '详细信息',
            icon: 'info',
            disabled: unavailable || !entry.permissions.details,
            description: !entry.permissions.details ? '没有访问权限' : undefined,
          },
        ]
      : []),
    { separator: true },
    {
      value: 'delete',
      label: '移入回收站',
      icon: 'trash',
      danger: true,
      disabled: unavailable || Boolean(reason),
      description: reason || undefined,
    },
  ];
}

function selectEntryMenu(value: string, selected: Entry, trigger: HTMLElement | null) {
  const entry = entries.value.find(
    (item) => item.key === selected.key && item.kind === selected.kind
  );
  if (!entry || loading.value || busy.value || creating.value) return;
  if (value === 'open' && entry.permissions.read && entry.location)
    void router.push(entry.location);
  else if (value === 'share' && entry.kind === 'document' && entry.permissions.write) {
    shareFile.value = { key: entry.key, name: entry.name };
    shareOpen.value = true;
  } else if (value === 'rename') rename(entry);
  else if (value === 'delete') void remove(entry, trigger);
  else if (value === 'details' && entry.kind === 'document' && entry.permissions.details) {
    detailsFile.value = { key: entry.key, name: entry.name };
    detailsOpen.value = true;
  }
}

async function load() {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const current = ++generation;
  const project = projectKey.value;
  loading.value = true;
  loadError.value = '';
  tree.value = null;
  try {
    await teams.ensure();
    if (signal.aborted || current !== generation) return;
    if (!project) throw new Error('目录地址缺少所属项目，请返回最近文件');
    const nextTree = await getProjectTree(project, signal);
    if (signal.aborted || current !== generation) return;
    if (route.query.team_key !== nextTree.project.team_key) {
      await router.replace({ query: { ...route.query, team_key: nextTree.project.team_key } });
      return;
    }
    tree.value = nextTree;
    if (!currentTeam.value) throw new Error('团队不存在或你已不在该团队');
  } catch (cause) {
    if (signal.aborted || current !== generation) return;
    loadError.value = errorMessage(cause, '目录加载失败');
  } finally {
    if (current === generation) loading.value = false;
  }
}

function setPage(value: number) {
  void router.replace({ query: { ...route.query, page: value > 1 ? String(value) : undefined } });
}

function createFile() {
  if (loading.value || busy.value || creating.value || !canWrite.value || !folderKey.value) return;
  openCreateDocument({ project_key: projectKey.value, folder_key: folderKey.value });
}

function createDirectory() {
  const project = projectKey.value;
  const selected = currentTeam.value;
  if (
    !project ||
    folderKey.value ||
    loading.value ||
    busy.value ||
    creating.value ||
    !canWrite.value ||
    !selected
  )
    return;
  modal.showModal(ModalType.INPUT_DIALOG, {
    title: '新建文件夹',
    tips: '文件夹名称',
    okText: '创建',
    onOK: async (name) => {
      await createFolder({ project_key: project, parent_key: null, name });
      teams.invalidateProjects();
      notification.show('文件夹已创建', 'success');
    },
  });
}

function rename(entry: Entry) {
  if (!entry.permissions.rename || busy.value) return;
  modal.showModal(ModalType.INPUT_DIALOG, {
    title: `重命名${entry.typeLabel}`,
    tips: `${entry.typeLabel}名称`,
    defaultValue: entry.name,
    okText: '保存',
    onOK: async (name) => {
      if (entry.kind === 'folder') await renameFolder(entry.key, name);
      else await updateDocument(entry.key, { file_name: name });
      notification.show('名称已更新', 'success');
      teams.invalidateProjects();
    },
  });
}

function deleteReason(entry: Entry): string {
  return entry.permissions.remove ? '' : '没有删除权限';
}

async function remove(entry: Entry, trigger: HTMLElement | null) {
  if (!active || loading.value || deleteReason(entry) || busy.value) return;
  const from = route.fullPath;
  const isCurrent = () => active && route.fullPath === from;
  async function confirmRemoval(content: string, cascade: boolean) {
    busy.value = false;
    await nextTick();
    if (!isCurrent()) return false;
    if (trigger?.isConnected && !trigger.matches(':disabled')) {
      trigger.focus({ preventScroll: true });
    }
    const accepted = await confirm({
      type: MessageType.WARNING,
      title: cascade ? '将文件夹移入回收站' : '将文件移入回收站',
      confirmText: '移入回收站',
      content,
    });
    if (!accepted || !isCurrent()) return false;
    busy.value = true;
    return true;
  }
  busy.value = true;
  try {
    if (entry.kind === 'folder') {
      const accepted = await confirmRemoval(
        `将文件夹「${entry.name}」移入回收站？文件夹内的内容将一并移入回收站，分享暂时不可用。可在 30 天保留期限内恢复。`,
        true
      );
      if (!accepted) return;
      await deleteFolder(entry.key, true);
    } else {
      const accepted = await confirmRemoval(
        `将「${entry.name}」移入回收站？正文和附件关联会保留，分享暂时不可用。可在 30 天保留期限内恢复。`,
        false
      );
      if (!accepted) return;
      await deleteDocument(entry.key);
    }
    notification.show(`${entry.typeLabel}已移入回收站`, 'success');
    teams.invalidateProjects();
  } catch (cause) {
    if (active) notification.show(errorMessage(cause), 'error', 0);
    teams.invalidateProjects();
  } finally {
    busy.value = false;
    await nextTick();
    if (isCurrent() && document.activeElement === document.body) {
      if (trigger?.isConnected && !trigger.matches(':disabled'))
        trigger.focus({ preventScroll: true });
      else fileList.value?.focusEntry(entry.key);
    }
  }
}

// Home keys this page by project; folder navigation reuses the loaded tree.
function permissionsSaved() {
  teams.invalidateProjects();
}
onMounted(load);
watch(() => teams.projectRevision, load);
watch(
  [title, error, loading],
  () => {
    document.title = `${loading.value ? '正在加载目录' : error.value ? '目录不可用' : title.value} · Voex`;
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  active = false;
  controller?.abort();
  generation++;
});
</script>

<style scoped lang="stylus">
.desktop
  position relative
  z-index 1
  display flex
  flex-direction column
  width 100%
  height 100%
  min-width 0
  min-height 0
  overflow hidden
  container-type inline-size
  color var(--color-text-secondary)
  font-size 13px
  line-height 20px

.desktop__toolbar
  display flex
  flex-shrink 0
  align-items center
  justify-content space-between
  gap 16px
  height 44px
  padding 0 12px
  border-bottom 1px solid var(--color-border-translucent)

.desktop__project-link
  min-width 0
  padding 4px 6px
  overflow hidden
  border-radius var(--border-radius-item-s)
  color var(--color-text-secondary)
  font-size 12px
  font-weight 600
  text-decoration none
  text-overflow ellipsis
  white-space nowrap

.desktop__project-link:hover
  background var(--color-bg-translucent)
  color var(--color-text-primary)

.desktop__breadcrumbs
  flex 1
  min-width 0
  min-height 28px
  max-height 112px
  overflow-y auto

.desktop__breadcrumb-list
  display flex
  flex-wrap wrap
  align-items center
  gap 4px
  margin 0
  padding 0
  list-style none

.desktop__breadcrumb-item
  display flex
  align-items center
  gap 4px
  min-width 0
  max-width 100%

.desktop__breadcrumb-separator
  color var(--color-text-quaternary)

.desktop__breadcrumb
  display inline-flex
  align-items center
  gap 6px
  min-width 0
  padding 3px 10px
  border 1px solid var(--color-border-translucent)
  border-radius 20px
  color var(--color-text-tertiary)
  font-size 12px
  line-height 20px
  overflow-wrap anywhere
  text-decoration none

.desktop__breadcrumb:hover
  background var(--color-bg-translucent)
  color var(--color-text-secondary)

.desktop__breadcrumb--current
  background var(--color-bg-translucent)
  color var(--color-text-secondary)
  font-weight 600

.desktop__button
  display inline-flex
  align-items center
  justify-content center
  gap 6px
  min-height 30px
  padding 4px 12px
  border 1px solid var(--color-border-translucent-strong)
  border-radius var(--border-radius-item-s)
  background var(--color-bg-translucent)
  color var(--color-text-secondary)
  font-size 12px
  text-decoration none
  white-space nowrap
  cursor pointer

.desktop__button:hover:not(:disabled)
  background var(--color-bg-quaternary)
  color var(--color-text-primary)

.desktop__button:active:not(:disabled)
  filter brightness(.94)

.desktop__button:disabled
  cursor not-allowed
  opacity .4


.desktop__create
  display inline-flex
  align-items center
  justify-content center
  flex-shrink 0
  width 28px
  height 28px
  border 1px solid var(--color-border-translucent-strong)
  border-radius 50%
  background var(--color-bg-translucent)
  color var(--color-text-secondary)
  cursor pointer
  &:hover:not(:disabled)
    background var(--color-bg-quaternary)
    color var(--color-text-primary)
  &:active:not(:disabled)
    filter brightness(.94)
  &:disabled
    cursor not-allowed
    opacity .4
.desktop__create:focus-visible, .desktop__project-link:focus-visible, .desktop__breadcrumb:focus-visible, .desktop__button:focus-visible
  outline 2px solid var(--color-accent)
  outline-offset -2px
</style>
