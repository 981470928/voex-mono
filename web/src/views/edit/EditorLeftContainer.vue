<template>
  <aside class="editor-left" :class="{ 'editor-left--mobile': mobile }" aria-label="当前项目目录">
    <div v-if="!mobile" class="editor-left__header">
      <h2 class="editor-left__title">项目列表</h2>
      <button
        type="button"
        class="edit-page__icon-button"
        title="关闭项目列表"
        aria-label="关闭项目列表"
        @click="$emit('toggle')"
      >
        <SvgIcon name="close" :size="18" />
      </button>
    </div>
    <RouterLink
      v-if="displayedTree"
      :to="
        desktopLocation(
          displayedTree.project.project_key,
          undefined,
          displayedTree.project.team_key
        )
      "
      class="editor-left__project"
      :title="displayedTree.project.name"
      ><SvgIcon name="folder" :size="18" aria-hidden="true" /><span>{{
        displayedTree.project.name
      }}</span
      ><SvgIcon name="chevron-right" :size="16" aria-hidden="true"
    /></RouterLink>
    <div class="editor-left__list" :aria-busy="loading">
      <p v-if="loading && !displayedTree" class="editor-left__status" role="status">
        正在加载目录…
      </p>
      <p v-else-if="error" class="editor-left__status" role="alert">{{ error }}</p>
      <p v-else-if="!nodes.length" class="editor-left__status">暂无文件夹</p>
      <ProjectTree
        v-else
        :nodes="nodes"
        :expanded="expanded"
        :active-key="displayedDocKey"
        :project="tree?.project"
        :busy="busy || loading"
        @toggle="toggleFolder"
        @rename="$emit('rename', $event)"
        @delete="$emit('delete', $event)"
      />
    </div>
    <div class="editor-left__footer">
      <button
        v-if="permission.folder(tree?.project).write"
        :disabled="loading || creating"
        @click="$emit('create')"
      >
        <SvgIcon name="cross" :size="18" aria-hidden="true" />创建文件
      </button>
      <RouterLink
        :to="
          desktopLocation(
            displayedTree?.project.project_key,
            activeFolderKey,
            displayedTree?.project.team_key
          )
        "
        title="在目录中查看"
        aria-label="在目录中查看"
        ><SvgIcon name="folder-open" :size="18"
      /></RouterLink>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import ProjectTree from '@/components/ProjectTree.vue';
import { buildDirectoryTree, desktopLocation, folderAncestors } from '@/utils/workspace';
import type { DocumentSummary } from '@/service/api/document-api';
import type { ProjectTree as ProjectTreeData } from '@/service/api/workspace-api';
import { usePermissionStore } from '@/stores/permission';

const props = defineProps<{
  tree: ProjectTreeData | null;
  mobile?: boolean;
  activeDocKey: string;
  loading?: boolean;
  creating?: boolean;
  busy?: boolean;
  error?: string;
}>();
defineEmits<{
  toggle: [];
  create: [];
  delete: [doc: DocumentSummary];
  rename: [doc: DocumentSummary];
}>();
const permission = usePermissionStore();
const expanded = ref(new Set<string>());
// 切换文件时父级会暂时清空数据，保留已渲染的目录，直到新数据返回或加载结束。
const displayedTree = computed<ProjectTreeData | null>(
  (previous) => props.tree ?? (props.loading ? (previous ?? null) : null)
);
const displayedDocKey = computed<string>(
  (previous) => props.activeDocKey || (props.loading ? (previous ?? '') : '')
);
const nodes = computed(() =>
  buildDirectoryTree(displayedTree.value?.folders ?? [], displayedTree.value?.documents ?? [])
);
const activeFolderKey = computed(
  () =>
    displayedTree.value?.documents.find((doc) => doc.file_key === displayedDocKey.value)?.folder_key
);

function toggleFolder(key: string) {
  if (expanded.value.has(key)) expanded.value.delete(key);
  else expanded.value.add(key);
}

watch(
  () => displayedTree.value?.project.project_key,
  (key, previous) => {
    if (key && previous && key !== previous) expanded.value = new Set();
  }
);
watch(
  [activeFolderKey, displayedTree],
  () => {
    for (const folder of folderAncestors(displayedTree.value?.folders ?? [], activeFolderKey.value))
      expanded.value.add(folder.folder_key);
  },
  { immediate: true }
);
</script>

<style scoped lang="stylus">
.editor-left
  display flex
  flex-direction column
  height 100%
  width 100%
  min-height 0
  min-width 0
  flex-shrink 0
  background transparent
  :deep(.project-tree--nested)
    border-left 0

  &--mobile
    flex 1
    width 100%
    min-height 0
    min-width 0
    border-right none

    :deep(.project-tree__folder), :deep(.project-tree__file > a)
      min-height 44px

    :deep(.project-tree__file > button)
      width 40px
      height 40px

    .editor-left__footer button, .editor-left__footer a
      min-height 44px

  &__header
    display flex
    align-items center
    justify-content space-between
    min-height 56px
    padding 0 14px
  &__title
    margin 0
    font-size 14px
    font-weight 600
    color var(--color-text-primary)
  &__project
    display flex
    align-items center
    gap 8px
    padding 16px 14px 10px
    color var(--color-text-primary)
    font-size 13px
    font-weight 600
    text-decoration none
    span
      flex 1
      min-width 0
      overflow hidden
      text-overflow ellipsis
      white-space nowrap
    svg
      flex-shrink 0
    &:hover
      color var(--color-link-hover)
  &__list
    flex 1
    min-height 0
    overflow auto
    padding 4px 8px 16px
    scrollbar-gutter stable
  &__status
    padding 24px 8px
    text-align center
    font-size 13px
    line-height 1.6
    color var(--color-text-secondary)
  &__footer
    display flex
    align-items center
    justify-content space-between
    gap 8px
    padding 8px 12px
    min-height 48px
    button, a
      display inline-flex
      align-items center
      gap 7px
      min-height 32px
      padding 5px
      border-radius 4px
      font-size 13px
      color var(--color-text-secondary)
      text-decoration none
      &:hover:not(:disabled)
        color var(--color-accent)
        background var(--color-bg-translucent)
</style>
