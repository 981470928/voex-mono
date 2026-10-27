<template>
  <aside class="home-aside" aria-label="Voex 工作台">
    <header class="home-aside__header">
      <div class="home-aside__brand">
        <img class="home-aside__logo" :src="logo" alt="" width="16" height="16" />
        <label class="home-aside__team-label" for="workspace-team">当前团队</label>
        <select
          id="workspace-team"
          class="home-aside__team-select"
          :value="currentTeam?.team_key || ''"
          :disabled="teams.loading || creating || busy"
          @change="switchTeam"
        >
          <option v-if="!currentTeam" value="">
            {{ teams.loading ? '正在加载团队…' : '选择团队' }}
          </option>
          <option v-for="team in teams.teams" :key="team.team_key" :value="team.team_key">
            {{ team.name }}{{ team.kind === 'personal' ? ' · 个人' : '' }}
          </option>
        </select>
      </div>
    </header>

    <div class="home-aside__navigation">
      <ul class="home-aside__list" aria-label="主导航">
        <li v-for="item in mainItems" :key="item.label">
          <RouterLink
            class="home-aside__item home-aside__nav-link"
            :class="{ 'home-aside__item--active': route.name === item.routeName }"
            :to="{ name: item.routeName, query: { team_key: currentTeam?.team_key } }"
            :aria-current="route.name === item.routeName ? 'page' : undefined"
          >
            <SvgIcon class="home-aside__icon" :name="item.icon" :size="14" />
            <span class="home-aside__label">{{ item.label }}</span>
          </RouterLink>
        </li>
      </ul>

      <section
        ref="projectSection"
        class="home-aside__section"
        aria-label="团队项目"
        :aria-busy="loading || busy"
        tabindex="-1"
      >
        <div class="home-aside__section-header">
          <h2 class="home-aside__section-title">
            项目
            <span class="home-aside__caret" aria-hidden="true"></span>
          </h2>
          <button
            v-if="currentTeam?.permissions.create_project"
            class="home-aside__create"
            type="button"
            title="创建项目"
            aria-label="创建项目"
            :disabled="loading || creating || busy || !currentTeam?.permissions.create_project"
            @click="openCreateProject"
          >
            <SvgIcon name="add" :size="14" />
          </button>
        </div>
        <p v-if="loading && !projects.length" class="home-aside__message" role="status">
          正在加载项目…
        </p>
        <div v-if="error" class="home-aside__message" role="alert">
          <p>{{ error }}</p>
          <button class="home-aside__retry" type="button" :disabled="loading" @click="loadProjects">
            重新加载
          </button>
        </div>
        <p v-else-if="!loading && !projects.length" class="home-aside__message">尚无项目</p>
        <ul v-if="projects.length" class="home-aside__list">
          <li
            v-for="project in projects"
            :key="project.project_key"
            class="home-aside__project-item"
            :class="{ 'home-aside__project-item--context': isProjectMenuOpen(project) }"
            @contextmenu.prevent.stop="openProjectMenu($event, project)"
            @keydown="handleProjectKeydown($event, project)"
          >
            <RouterLink
              class="home-aside__item home-aside__project"
              :class="{ 'home-aside__item--active': projectKey === project.project_key }"
              :to="{
                name: 'project',
                params: { projectId: project.project_key, folderId: '' },
                query: { team_key: project.team_key },
              }"
              :aria-current="projectKey === project.project_key ? 'page' : undefined"
              :title="project.name"
              aria-keyshortcuts="Shift+F10"
            >
              <SvgIcon class="home-aside__icon" name="project-original" :size="14" />
              <span class="home-aside__label">{{ project.name }}</span>
            </RouterLink>
            <button
              class="home-aside__project-menu"
              type="button"
              title="更多操作"
              :aria-label="project.name + '的更多操作'"
              aria-haspopup="menu"
              :aria-expanded="isProjectMenuOpen(project)"
              :disabled="loading || creating || busy"
              @click.stop="openProjectMenu($event, project, true)"
              @keydown.down.prevent.stop="openProjectMenu($event, project, true)"
            >
              <SvgIcon name="more-16" :size="16" />
            </button>
          </li>
        </ul>
      </section>

      <!-- <section class="home-aside__section" aria-label="Favorites">
        <h2 class="home-aside__section-title">
          Favorites
          <span class="home-aside__caret" aria-hidden="true"></span>
        </h2>
        <ul class="home-aside__list">
          <li class="home-aside__item">
            <svg
              class="home-aside__status"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.5" />
              <path d="M8 4a4 4 0 0 1 0 8V4Z" fill="currentColor" />
            </svg>
            <span class="home-aside__label">Faster app launch</span>
          </li>
          <li class="home-aside__item">
            <svg
              class="home-aside__icon"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M5 13H3.5A1.5 1.5 0 0 1 2 11.5v-8A1.5 1.5 0 0 1 3.5 2h8A1.5 1.5 0 0 1 13 3.5V5M7 6l7 2.5-3 1.5-1.5 3L7 6Z"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="home-aside__label">Agent tasks</span>
          </li>
          <li v-for="item in favoriteItems" :key="item.label" class="home-aside__item">
            <SvgIcon class="home-aside__icon" :name="item.icon" :size="14" :color="item.color" />
            <span class="home-aside__label">{{ item.label }}</span>
          </li>
        </ul>
      </section> -->
    </div>
    <RouterLink class="home-aside__account" :to="{ name: 'profile' }" aria-label="账户资料">
      <img v-if="authUser?.avator" :src="authUser.avator" alt="" width="28" height="28" />
      <span v-else class="home-aside__account-placeholder"
        ><SvgIcon name="users" :size="16"
      /></span>
      <span class="home-aside__label">{{ authUser?.name || '账户资料' }}</span>
      <SvgIcon class="home-aside__account-setting" name="setting" :size="15" />
    </RouterLink>
    <VoexContextMenu
      v-if="contextMenu"
      v-model="contextMenuOpen"
      :items="contextMenuItems"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :trigger="contextMenu.trigger"
      :label="(contextProject?.name || '项目') + '的操作'"
      @select="selectProjectMenu"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import SvgIcon from '@/components/SvgIcon.vue';
import logo from '@/assets/image/voex-icon-white-16.png';
import {
  queryProjects,
  createProject,
  renameProject,
  deleteProject,
  createFolder,
  type ProjectInfo,
} from '@/service/api/workspace-api';
import { ModalType, useModalStore } from '@/stores/modal';
import { useNotificationStore } from '@/stores/notification';
import { errorMessage } from '@/utils/error';
import { authUser } from '@/service/auth-session';
import { useTeamStore } from '@/stores/team';
import { usePermissionStore } from '@/stores/permission';
import { useConfirm } from '@/composables/useConfirm';
import { MessageType } from '@/constant/status';
import {
  VoexContextMenu,
  type ContextMenuItem,
  type ContextMenuOption,
} from '@/plugins/context-menu';

const route = useRoute();
const router = useRouter();
const modal = useModalStore();
const notification = useNotificationStore();
const teams = useTeamStore();
const permission = usePermissionStore();
const { confirm } = useConfirm();
const currentTeam = computed(() =>
  teams.resolve(typeof route.query.team_key === 'string' ? route.query.team_key : undefined)
);
const projects = ref<ProjectInfo[]>([]);
const loading = ref(true);
const creating = ref(false);
const busy = ref(false);
const projectSection = ref<HTMLElement>();
const contextMenuOpen = ref(false);
const contextMenu = shallowRef<{
  projectKey: string;
  x: number;
  y: number;
  trigger: HTMLElement | null;
} | null>(null);
const contextProject = computed(() =>
  projects.value.find((project) => project.project_key === contextMenu.value?.projectKey)
);
const contextMenuItems = computed<ContextMenuItem[]>(() => {
  const project = contextProject.value;
  if (!project) return [];
  const disabled =
    loading.value || creating.value || busy.value || !permission.project(project).write;
  return [
    ...(permission.project(project).write
      ? [
          {
            value: 'create-folder',
            label: '创建文件夹',
            icon: 'folder',
            disabled,
            description: !permission.project(project).write ? '没有编辑权限' : undefined,
          },
        ]
      : []),
    {
      value: 'rename',
      label: '重命名',
      icon: 'write',
      disabled,
      description: !permission.project(project).write ? '没有编辑权限' : undefined,
    },
    { separator: true },
    {
      value: 'delete',
      label: '彻底删除项目',
      icon: 'trash',
      danger: true,
      disabled:
        loading.value || creating.value || busy.value || !permission.project(project).remove,
      description: permission.project(project).remove ? '包含回收站内容，无法恢复' : '没有删除权限',
    },
  ];
});
const error = ref('');
const projectKey = computed(() =>
  typeof route.params.projectId === 'string' ? route.params.projectId : undefined
);
let controller: AbortController | undefined;
let active = true;
let focusAfterRefresh: { target: HTMLElement | null; location: string } | undefined;

function isProjectMenuOpen(project: ProjectInfo) {
  return contextMenuOpen.value && contextMenu.value?.projectKey === project.project_key;
}

function openProjectMenu(
  event: MouseEvent | KeyboardEvent,
  project: ProjectInfo,
  dropdown = false
) {
  if (!active || loading.value || creating.value || busy.value) return;
  const source = event.currentTarget as HTMLElement;
  if (
    dropdown &&
    event.type === 'click' &&
    isProjectMenuOpen(project) &&
    contextMenu.value?.trigger === source
  ) {
    contextMenuOpen.value = false;
    return;
  }
  const target =
    event.target instanceof Element ? event.target.closest<HTMLElement>('a, button') : null;
  const trigger =
    target && source.contains(target) && !target.matches(':disabled')
      ? target
      : source.querySelector<HTMLElement>('.home-aside__project');
  const rect = (trigger ?? source).getBoundingClientRect();
  const keyboard = event instanceof KeyboardEvent || (event.clientX === 0 && event.clientY === 0);
  contextMenu.value = {
    projectKey: project.project_key,
    x: dropdown || keyboard ? rect.left : event.clientX,
    y: dropdown ? rect.bottom + 4 : keyboard ? rect.bottom : event.clientY,
    trigger,
  };
  contextMenuOpen.value = true;
}

function handleProjectKeydown(event: KeyboardEvent, project: ProjectInfo) {
  if (
    event.isComposing ||
    (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  openProjectMenu(event, project);
}

function canEditProject(project: ProjectInfo) {
  return (
    active &&
    !loading.value &&
    !creating.value &&
    !busy.value &&
    currentTeam.value?.team_key === project.team_key &&
    projects.value.some(
      (item) => item.project_key === project.project_key && permission.project(item).write
    )
  );
}

function selectProjectMenu(item: ContextMenuOption) {
  const project = contextProject.value;
  if (!project || !canEditProject(project)) return;
  if (item.value === 'rename' || item.value === 'create-folder') {
    openProjectInput(project, item.value);
  } else if (item.value === 'delete' && permission.project(project).remove) {
    void removeProject(project);
  }
}

function openProjectInput(project: ProjectInfo, action: 'rename' | 'create-folder') {
  const rename = action === 'rename';
  const from = route.fullPath;
  const trigger = contextMenu.value?.trigger ?? null;
  modal.showModal(ModalType.INPUT_DIALOG, {
    title: rename ? '重命名项目' : '新建文件夹',
    tips: rename ? '项目名称' : `文件夹名称（项目：${project.name}）`,
    defaultValue: rename ? project.name : undefined,
    okText: rename ? '保存' : '创建',
    onOK: async (name) => {
      if (!canEditProject(project) || route.fullPath !== from) {
        throw new Error('项目状态已变化，请关闭弹窗后重试');
      }
      busy.value = true;
      try {
        if (rename) await renameProject(project.project_key, name);
        else await createFolder({ project_key: project.project_key, parent_key: null, name });
        if (active) focusAfterRefresh = { target: trigger, location: from };
        teams.invalidateProjects();
        if (active) notification.show(rename ? '项目名称已更新' : '文件夹已创建', 'success');
      } finally {
        busy.value = false;
      }
    },
  });
}

async function removeProject(project: ProjectInfo) {
  if (!canEditProject(project) || !permission.project(project).remove) return;
  const from = route.fullPath;
  const trigger = contextMenu.value?.trigger;
  let restoreFocus = false;
  busy.value = true;
  try {
    const accepted = await confirm({
      type: MessageType.ERROR,
      title: '彻底删除项目',
      content: `彻底删除项目「${project.name}」？项目内的全部文件夹、文件、附件关联和回收站内容将一并删除，分享链接将失效。项目不会进入回收站，此操作无法恢复。`,
      confirmText: '彻底删除项目',
    });
    busy.value = false;
    if (!accepted || !canEditProject(project) || route.fullPath !== from) return;
    busy.value = true;
    await deleteProject(project.project_key, true);
    if (active) {
      restoreFocus = route.fullPath === from;
      if (currentTeam.value?.team_key === project.team_key) {
        controller?.abort();
        projects.value = projects.value.filter((item) => item.project_key !== project.project_key);
        loading.value = false;
        error.value = '';
      }
      notification.show('项目已彻底删除', 'success');
      if (restoreFocus && projectKey.value === project.project_key) {
        try {
          await router.replace({ name: 'recent', query: { team_key: project.team_key } });
        } catch (cause) {
          notification.show(errorMessage(cause, '项目已删除，请从侧栏选择其他项目'), 'error');
        }
      }
    }
    teams.invalidateProjects();
  } catch (cause) {
    if (active) notification.show(errorMessage(cause, '删除项目失败'), 'error', 0);
  } finally {
    busy.value = false;
    if (active) {
      await nextTick();
      if (document.activeElement === document.body) {
        if (restoreFocus) projectSection.value?.focus({ preventScroll: true });
        else if (route.fullPath === from && trigger?.isConnected && !trigger.matches(':disabled')) {
          trigger.focus({ preventScroll: true });
        }
      }
    }
  }
}

async function loadProjects() {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  loading.value = true;
  error.value = '';
  try {
    await teams.ensure();
    if (signal.aborted) return;
    const selected = currentTeam.value;
    if (!selected) throw new Error('团队不存在或你已不在该团队');
    const result = await queryProjects(signal, selected.team_key);
    if (signal.aborted) return;
    projects.value = result;
  } catch (cause) {
    if (!signal.aborted) error.value = errorMessage(cause, '项目加载失败');
  } finally {
    if (!signal.aborted) {
      loading.value = false;
      await nextTick();
      const focus = focusAfterRefresh;
      focusAfterRefresh = undefined;
      if (
        active &&
        focus?.location === route.fullPath &&
        document.activeElement === document.body &&
        focus.target?.isConnected &&
        !focus.target.matches(':disabled')
      ) {
        focus.target.focus({ preventScroll: true });
      }
    }
  }
}

function openCreateProject() {
  const selected = currentTeam.value;
  if (
    !active ||
    loading.value ||
    creating.value ||
    busy.value ||
    !selected?.permissions.create_project
  )
    return;
  modal.showModal(ModalType.INPUT_DIALOG, {
    title: '创建项目',
    tips: '项目名称',
    okText: '创建',
    onOK: async (name) => {
      if (!active || creating.value) return;
      creating.value = true;
      const from = route.fullPath;
      try {
        const project = await createProject(name, selected.team_key);
        if (!active) return;
        controller?.abort();
        projects.value = [...projects.value, project];
        loading.value = false;
        error.value = '';
        notification.show('项目已创建', 'success');
        teams.invalidateProjects();
        if (route.fullPath === from) {
          // Navigation failures must not turn a completed creation into a retryable submission.
          try {
            await router.push({
              name: 'project',
              params: { projectId: project.project_key, folderId: '' },
              query: { team_key: project.team_key },
            });
          } catch (cause) {
            notification.show(errorMessage(cause, '项目已创建，打开失败，请从列表进入'), 'error');
          }
        }
      } finally {
        creating.value = false;
      }
    },
  });
}

async function switchTeam(event: Event) {
  const input = event.target as HTMLSelectElement;
  await router.push({
    name: route.name === 'trash' ? 'trash' : 'recent',
    query: { team_key: input.value },
  });
  input.value = currentTeam.value?.team_key ?? '';
}
watch([() => route.fullPath, loading, creating, busy], () => {
  contextMenuOpen.value = false;
});
watch([projectKey, () => route.query.team_key, () => teams.projectRevision], loadProjects, {
  immediate: true,
});
onBeforeUnmount(() => {
  active = false;
  controller?.abort();
});

const mainItems = [
  { label: '最近文件', icon: 'clock-outline', routeName: 'recent' },
  { label: '回收站', icon: 'trash', routeName: 'trash' },
  { label: '团队与成员', icon: 'users', routeName: 'teams' },
  // { label: 'Pulse', icon: 'pulse' },
  // { label: 'Inbox', icon: 'inbox' },
  // { label: 'My issues', icon: 'issues' },
  // { label: 'Reviews', icon: 'reviews' },
];

// const favoriteItems = [
//   { label: 'Agent Insights', icon: 'bar-chart', color: 'var(--color-indigo)' },
//   { label: 'UI Refresh', icon: 'design-tools', color: 'var(--color-orange)' },
// ];
</script>

<style scoped lang="stylus">
.home-aside
  position relative
  display flex
  flex-direction column
  flex 0 0 240px
  width 240px
  max-width 100%
  height 100%
  min-height 0
  padding 12px 12px 12px 4px
  overflow hidden
  border-radius 8px 0 0 8px
  color #a4a7ad
  font-size 13px
  font-weight 500
  line-height 20px

.home-aside__header
  display flex
  flex-shrink 0
  align-items center
  justify-content space-between
  height 28px
  margin-bottom 16px
  padding-left 6px

.home-aside__brand
  display flex
  align-items center
  gap 8px
  min-width 0
  width 100%

.home-aside__team-label
  position absolute
  width 1px
  height 1px
  overflow hidden
  clip-path inset(50%)

.home-aside__team-select
  width 100%
  min-width 0
  height 32px
  border 1px solid var(--color-border-translucent-strong)
  border-radius 6px
  padding 0 6px
  background var(--color-bg-secondary)
  color var(--color-text-primary)
  font inherit
  cursor pointer
  &:hover:not(:disabled)
    background var(--color-bg-quaternary)
  &:focus-visible
    outline 2px solid var(--color-accent)
  &:disabled
    opacity .5
    cursor not-allowed

.home-aside__logo
  display block
  flex-shrink 0
  object-fit contain

.home-aside__name
  color var(--color-text-primary)
  font-size 14px
  font-weight 600

.home-aside__chevron
  margin-left -3px
  color var(--color-text-quaternary)
  transform rotate(90deg)

.home-aside__actions
  display flex
  align-items center
  gap 8px
  color var(--color-text-quaternary)

.home-aside__search
  display flex
  align-items center
  justify-content center
  width 24px
  height 28px

.home-aside__compose
  display flex
  align-items center
  justify-content center
  width 28px
  height 28px
  border 1px solid var(--color-border-translucent-strong)
  border-radius 50%
  color var(--color-text-secondary)

.home-aside__navigation
  min-height 0
  overflow-y auto

.home-aside__account
  display flex
  flex-shrink 0
  align-items center
  gap 8px
  min-height 44px
  margin-top auto
  padding 8px 6px
  border-top 1px solid var(--color-border-translucent-strong)
  color var(--color-text-secondary)
  text-decoration none

  &:hover
    background var(--color-bg-translucent)

  &:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset -2px

  img
    flex-shrink 0
    border-radius 50%
    object-fit cover

.home-aside__account-placeholder
  display flex
  flex-shrink 0
  align-items center
  justify-content center
  width 28px
  height 28px
  border-radius 50%
  background var(--color-bg-translucent)

.home-aside__account-setting
  flex-shrink 0
  margin-left auto

.home-aside__list
  display flex
  flex-direction column
  gap 2px
  margin 0
  padding 0
  list-style none

.home-aside__item
  display flex
  align-items center
  gap 8px
  min-height 28px
  padding 4px 6px
  border-radius var(--border-radius-item-m)

.home-aside__item--active
  background var(--color-bg-translucent)

.home-aside__project-item
  position relative

  &:hover .home-aside__project,
  &--context .home-aside__project
    background var(--color-bg-translucent)
    color var(--color-text-primary)

  &:hover .home-aside__project-menu,
  &:focus-within .home-aside__project-menu,
  &--context .home-aside__project-menu
    opacity 1
    pointer-events auto

.home-aside__project
  padding-right 32px

.home-aside__project-menu
  position absolute
  top 50%
  right 2px
  transform translateY(-50%)
  display flex
  align-items center
  justify-content center
  width 24px
  height 24px
  border-radius var(--border-radius-item-s)
  color var(--color-text-tertiary)
  opacity 0
  pointer-events none
  cursor pointer

  &:hover:not(:disabled)
    background var(--color-bg-quaternary)
    color var(--color-text-primary)

  &:active:not(:disabled)
    background var(--color-bg-translucent)

  &:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset -2px

  &:disabled
    cursor not-allowed
    color var(--color-text-quaternary)

@media (hover: none), (pointer: coarse)
  .home-aside__project-menu
    opacity 1
    pointer-events auto

.home-aside__nav-link,
.home-aside__project
  color inherit
  text-decoration none
  cursor pointer

.home-aside__nav-link:hover,
.home-aside__project:hover
  background var(--color-bg-translucent)
  color var(--color-text-primary)

.home-aside__nav-link:active,
.home-aside__project:active
  background var(--color-bg-translucent)

.home-aside__nav-link:focus-visible,
.home-aside__project:focus-visible
  outline 2px solid var(--color-accent)
  outline-offset -2px

.home-aside__icon
  flex-shrink 0
  color var(--color-text-tertiary)

.home-aside__label
  min-width 0
  overflow hidden
  text-overflow ellipsis
  white-space nowrap

.home-aside__section
  margin-top 20px
  min-height 200px
  &:hover .home-aside__create
    display flex


.home-aside__section-header
  display flex
  align-items center
  justify-content space-between
  min-height 24px
  margin-bottom 2px

.home-aside__create
  display flex
  align-items center
  justify-content center
  width 24px
  height 24px
  flex-shrink 0
  border-radius var(--border-radius-item-s)
  color var(--color-text-tertiary)
  cursor pointer

.home-aside__create:hover:not(:disabled)
  background var(--color-bg-translucent)
  color var(--color-text-primary)

.home-aside__create:focus-visible
  outline 2px solid var(--color-accent)
  outline-offset -2px

.home-aside__create:active:not(:disabled)
  background var(--color-bg-translucent)

.home-aside__create:disabled
  cursor not-allowed
  opacity .45

.home-aside__message
  padding 4px 6px
  color var(--color-text-tertiary)
  font-size 12px
  overflow-wrap anywhere

.home-aside__retry
  margin-top 4px
  padding 2px 0
  color var(--color-link-primary)
  cursor pointer

.home-aside__retry:hover:not(:disabled)
  color var(--color-link-hover)
  text-decoration underline

.home-aside__retry:focus-visible
  outline 2px solid var(--color-accent)
  outline-offset 2px

.home-aside__retry:disabled
  cursor not-allowed

.home-aside__section-title
  display flex
  align-items center
  gap 5px
  height 20px
  margin 0
  padding 0 6px
  color var(--color-text-quaternary)
  font-size 12px
  font-weight 500

.home-aside__caret
  width 0
  height 0
  border-top 4px solid currentColor
  border-right 3px solid transparent
  border-left 3px solid transparent

.home-aside__status
  flex-shrink 0
  color var(--color-yellow)
</style>
