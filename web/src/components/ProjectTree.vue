<template>
  <ul class="project-tree" :class="{ 'project-tree--nested': nested }">
    <li v-for="node in nodes" :key="node.key" class="project-tree__node">
      <template v-if="node.folder">
        <button
          class="project-tree__folder"
          :aria-expanded="expanded.has(node.key)"
          :title="node.folder.name"
          @click="$emit('toggle', node.key)"
        >
          <SvgIcon
            name="chevron-right"
            :size="16"
            :class="{ 'project-tree__arrow--open': expanded.has(node.key) }"
            aria-hidden="true"
          />
          <SvgIcon
            v-if="expanded.has(node.key)"
            name="folder-open"
            :size="17"
            aria-hidden="true"
          /><SvgIcon v-else name="folder" :size="17" aria-hidden="true" />
          <span>{{ node.folder.name }}</span>
        </button>
        <template v-if="expanded.has(node.key)">
          <ProjectTree
            v-if="node.children.length"
            :nodes="node.children"
            :expanded="expanded"
            :active-key="activeKey"
            :project="project"
            :busy="busy"
            nested
            @toggle="$emit('toggle', $event)"
            @rename="$emit('rename', $event)"
            @delete="$emit('delete', $event)"
          />
          <p v-else class="project-tree__empty">空文件夹</p>
        </template>
      </template>
      <div
        v-else-if="node.document"
        class="project-tree__file"
        :class="{ 'project-tree__file--active': node.key === activeKey }"
      >
        <RouterLink
          :to="{ name: 'edit', params: { file_key: node.key } }"
          :title="node.document.file_name"
          :aria-current="node.key === activeKey ? 'page' : undefined"
        >
          <SvgIcon name="page" :size="16" aria-hidden="true" /><span>{{
            node.document.file_name
          }}</span>
        </RouterLink>
        <button
          :disabled="!permission.document(node.document, project).rename || busy"
          :aria-label="`重命名${node.document.file_name}`"
          title="重命名"
          @click="$emit('rename', node.document)"
        >
          <SvgIcon name="write" :size="14" />
        </button>
        <button
          class="project-tree__delete"
          :disabled="!permission.document(node.document, project).remove || busy"
          :aria-label="`将${node.document.file_name}移入回收站`"
          title="移入回收站"
          @click="$emit('delete', node.document)"
        >
          <SvgIcon name="trash" :size="14" />
        </button>
      </div>
    </li>
  </ul>
</template>

<script setup lang="ts">
import SvgIcon from '@/components/SvgIcon.vue';
import type { DocumentSummary } from '@/service/api/document-api';
import type { DirectoryNode } from '@/utils/workspace';
import type { ProjectInfo } from '@/service/api/workspace-api';
import { usePermissionStore } from '@/stores/permission';

const permission = usePermissionStore();
defineProps<{
  nodes: DirectoryNode[];
  expanded: Set<string>;
  activeKey: string;
  project?: ProjectInfo;
  busy?: boolean;
  nested?: boolean;
}>();
defineEmits<{
  toggle: [key: string];
  rename: [doc: DocumentSummary];
  delete: [doc: DocumentSummary];
}>();
</script>

<style scoped lang="stylus">
.project-tree
  list-style none
  &--nested
    margin-left 12px
    padding-left 4px
    border-left 1px solid var(--color-border-translucent-strong)
  &__node
    min-width 0
  &__folder, &__file
    display flex
    align-items center
    min-height 36px
    width 100%
    border-radius 5px
    color var(--color-text-primary)
    font-size 13px
    &:hover
      background var(--color-bg-translucent)
    span
      overflow hidden
      text-overflow ellipsis
      white-space nowrap
    svg
      flex-shrink 0
  &__folder
    gap 5px
    padding 5px 6px
    text-align left
    svg:not(:first-child)
      color var(--color-blue)
  &__arrow--open
    transform rotate(90deg)
  &__file
    padding 2px 3px 2px 7px
    &--active
      background var(--color-accent-tint)
      > a
        color var(--color-accent)
        font-weight 600
    a
      display flex
      align-items center
      flex 1
      gap 7px
      min-width 0
      padding 6px 0
      color inherit
      text-decoration none
      &[aria-current=page]
        color var(--color-accent)
        font-weight 600
    button
      display inline-flex
      align-items center
      justify-content center
      width 26px
      height 28px
      flex-shrink 0
      border-radius 4px
      color var(--color-text-secondary)
      &:hover:not(:disabled)
        color var(--color-accent)
        background var(--color-accent-tint)
    .project-tree__delete:hover:not(:disabled)
      color var(--color-red)
  &__empty
    padding 8px 0 8px 28px
    font-size 12px
    color var(--color-text-secondary)
</style>
