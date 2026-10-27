<template>
  <main class="trash-page team-ui">
    <header class="trash-page__header">
      <h1 class="trash-page__title">回收站</h1>
      <div v-if="canManageAll" class="team-ui__actions">
        <button
          type="button"
          class="team-ui__button"
          :disabled="loading || !!busy || !total"
          @click="bulk('restore')"
        >
          恢复全部
        </button>
        <button
          type="button"
          class="team-ui__button"
          :disabled="loading || !!busy || !total"
          @click="bulk('purge')"
        >
          清空回收站
        </button>
      </div>
      <button class="team-ui__button" type="button" :disabled="loading || !!busy" @click="load">
        <SvgIcon name="refresh" :size="14" />刷新
      </button>
    </header>
    <div class="trash-page__toolbar">
      <div class="trash-page__filter">
        <label for="trash-project">所属项目</label>
        <select
          id="trash-project"
          class="team-ui__input"
          :value="projectKey"
          :disabled="!!busy"
          @change="setFilter('project_key', $event)"
        >
          <option value="">全部项目</option>
          <option
            v-if="projectKey && !readableProjects.some((item) => item.project_key === projectKey)"
            :value="projectKey"
          >
            当前项目不可用
          </option>
          <option
            v-for="project in readableProjects"
            :key="project.project_key"
            :value="project.project_key"
          >
            {{ project.name }}
          </option>
        </select>
      </div>
      <div class="trash-page__filter trash-page__filter--size">
        <label for="trash-limit">每页条数</label>
        <select
          id="trash-limit"
          class="team-ui__input"
          :value="limit"
          :disabled="!!busy"
          @change="setFilter('limit', $event)"
        >
          <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }} 条</option>
        </select>
      </div>
    </div>
    <p class="trash-page__description">
      {{ teamName }} · 移入回收站后保留 30
      天，到期后无法恢复。文件夹恢复到原项目，文件恢复到原文件夹。
    </p>
    <p v-if="actionError" class="trash-page__error" role="alert">{{ actionError }}</p>
    <section
      ref="contentElement"
      class="trash-page__content"
      aria-label="回收站列表"
      :aria-busy="loading || !!busy"
      tabindex="-1"
    >
      <div v-if="loading" class="team-ui__state trash-page__state" role="status">
        <SvgIcon class="trash-page__spinner" name="loading" :size="28" />
        <p>正在加载回收站…</p>
      </div>
      <div v-else-if="loadError" class="team-ui__state trash-page__state" role="alert">
        <SvgIcon name="alert" :size="32" />
        <h2>回收站加载失败</h2>
        <p>{{ loadError }}</p>
        <button class="team-ui__button" type="button" :disabled="!!busy" @click="load">
          重新加载
        </button>
      </div>
      <div v-else-if="!items.length" class="team-ui__state trash-page__state">
        <SvgIcon name="trash" :size="40" />
        <h2>{{ projectKey ? '这个项目的回收站为空' : '回收站为空' }}</h2>
        <p>可管理项目中未到期的文件和文件夹会显示在这里。</p>
      </div>
      <table v-else class="trash-page__table">
        <caption class="trash-page__caption">
          回收站中的文件和文件夹，按移入时间倒序排列
        </caption>
        <thead>
          <tr>
            <th scope="col">名称</th>
            <th scope="col">所属项目</th>
            <th scope="col">移入时间 / 删除人</th>
            <th scope="col">到期时间</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="rowKey(item)" :data-trash-key="rowKey(item)">
            <th scope="row" class="trash-page__name">
              <div class="trash-page__object">
                <SvgIcon
                  :name="item.type === 'folder' ? 'folder' : 'page'"
                  :size="18"
                  :class="{ 'trash-page__folder': item.type === 'folder' }"
                />
                <span>{{ item.name }}</span>
              </div>
              <span class="trash-page__hint">{{
                item.type === 'folder' ? `文件夹 · ${item.document_count} 个文件` : '文件'
              }}</span>
            </th>
            <td data-label="所属项目">
              {{ projectNames.get(item.project_key) || '项目名称不可用' }}
            </td>
            <td data-label="移入时间 / 删除人">
              <time :datetime="item.deleted_at">{{ formatTime(item.deleted_at) }}</time>
              <span class="trash-page__hint">{{ item.deleted_by?.name || '未知用户' }}</span>
            </td>
            <td data-label="到期时间">
              <time :datetime="item.expires_at">{{ formatTime(item.expires_at) }}</time>
            </td>
            <td class="trash-page__operation">
              <div class="team-ui__actions">
                <button
                  class="team-ui__button"
                  type="button"
                  :disabled="!!busy || !item.can_restore"
                  :aria-label="`恢复${item.name}`"
                  @click="mutate(item, 'restore', $event)"
                >
                  恢复
                </button>
                <button
                  class="team-ui__button team-ui__button--danger"
                  type="button"
                  :disabled="!!busy || !item.can_purge"
                  :aria-label="`彻底删除${item.name}`"
                  @click="mutate(item, 'purge', $event)"
                >
                  彻底删除
                </button>
              </div>
              <span v-if="busy === rowKey(item)" class="trash-page__hint" role="status"
                >正在处理…</span
              >
              <span v-else-if="!item.can_restore" class="trash-page__hint">{{
                item.type === 'document' ? '请先恢复原文件夹' : '暂时无法恢复，请刷新状态'
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <nav class="trash-page__pagination team-ui__pagination" aria-label="回收站分页">
      <span role="status">{{
        loading
          ? '正在加载…'
          : loadError
            ? '列表不可用'
            : `${total ? offset + 1 : 0}–${offset + items.length} / 共 ${total} 项`
      }}</span>
      <button
        class="team-ui__button"
        type="button"
        :disabled="loading || !!busy || !!loadError || page <= 1"
        @click="setPage(page - 1)"
      >
        上一页
      </button>
      <span>第 {{ page }} / {{ pageCount }} 页</span>
      <button
        class="team-ui__button"
        type="button"
        :disabled="loading || !!busy || !!loadError || page >= pageCount"
        @click="setPage(page + 1)"
      >
        下一页
      </button>
    </nav>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SvgIcon from '@/components/SvgIcon.vue';
import {
  listTrash,
  restoreTrash,
  purgeTrash,
  restoreAllTrash,
  clearTrash,
  type TrashItem,
} from '@/service/api/trash-api';
import { queryProjects, type ProjectInfo } from '@/service/api/workspace-api';
import { authUser } from '@/service/auth-session';
import { useTeamStore } from '@/stores/team';
import { useNotificationStore } from '@/stores/notification';
import { useConfirm } from '@/composables/useConfirm';
import { MessageType } from '@/constant/status';
import { formatTime } from '@/utils/workspace';
import { errorMessage } from '@/utils/error';

const PAGE_SIZES = [20, 50, 100];
const route = useRoute();
const router = useRouter();
const teams = useTeamStore();
const notification = useNotificationStore();
const { confirm } = useConfirm();
const items = ref<TrashItem[]>([]);
const projects = ref<ProjectInfo[]>([]);
const total = ref(0);
const canManageAll = ref(false);
const loading = ref(true);
const loadError = ref('');
const actionError = ref('');
const busy = ref('');
const contentElement = ref<HTMLElement>();
const teamKey = computed(() =>
  typeof route.query.team_key === 'string' ? route.query.team_key : undefined
);
const projectKey = computed(() =>
  typeof route.query.project_key === 'string' ? route.query.project_key : ''
);
const teamName = computed(() => teams.resolve(teamKey.value)?.name || '当前团队');
const readableProjects = computed(() =>
  projects.value.filter((project) => project.permissions.read)
);
const projectNames = computed(
  () => new Map(projects.value.map((project) => [project.project_key, project.name]))
);
const limit = computed(() =>
  PAGE_SIZES.includes(Number(route.query.limit)) ? Number(route.query.limit) : 50
);
const page = computed(() => {
  const value = Number(route.query.page);
  return Number.isSafeInteger(value) &&
    value > 0 &&
    value <= Math.floor(Number.MAX_SAFE_INTEGER / limit.value)
    ? value
    : 1;
});
const offset = computed(() => (page.value - 1) * limit.value);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)));
let controller: AbortController | undefined;
let disposed = false;

function rowKey(item: TrashItem) {
  return `${item.type}:${item.key}`;
}

async function load() {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const query = {
    project_key: projectKey.value || undefined,
    limit: limit.value,
    offset: offset.value,
  };
  const requestedTeam = teamKey.value;
  loading.value = true;
  loadError.value = '';
  items.value = [];
  total.value = 0;
  canManageAll.value = false;
  projects.value = [];
  try {
    await teams.ensure();
    if (signal.aborted) return;
    const team = teams.resolve(requestedTeam);
    if (!team) throw new Error('团队不存在或你已不在该团队');
    const [projectList, result] = await Promise.all([
      queryProjects(signal, team.team_key).then((result) => {
        if (!signal.aborted) projects.value = result;
        return result;
      }),
      listTrash({ ...query, team_key: team.team_key }, signal),
    ]);
    if (signal.aborted) return;
    projects.value = projectList;
    total.value = result.total;
    canManageAll.value = result.can_manage_all;
    if (!result.items.length && query.offset > 0) {
      await setPage(Math.max(1, Math.ceil(result.total / query.limit)));
      return;
    }
    items.value = result.items;
  } catch (cause) {
    if (!signal.aborted) loadError.value = errorMessage(cause, '回收站加载失败');
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

function setPage(value: number) {
  return router.replace({ query: { ...route.query, page: value > 1 ? String(value) : undefined } });
}

function setFilter(key: 'project_key' | 'limit', event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  void router.replace({ query: { ...route.query, [key]: value || undefined, page: undefined } });
}

async function bulk(action: 'restore' | 'purge') {
  if (!canManageAll.value || loading.value || busy.value) return;
  const team = teams.resolve(teamKey.value);
  if (!team) return;
  const location = route.fullPath;
  const user = authUser.value?.id;
  const project = projectKey.value;
  busy.value = 'bulk';
  actionError.value = '';
  let requested = false;
  try {
    const accepted = await confirm({
      type: action === 'purge' ? MessageType.ERROR : MessageType.WARNING,
      title: action === 'purge' ? '清空回收站' : '恢复全部',
      content:
        action === 'purge'
          ? '彻底删除当前筛选范围内全部回收站内容（包括文件夹内的文件）？此操作无法撤销。'
          : '恢复当前筛选范围内所有未过期的文件和文件夹？',
      confirmText: action === 'purge' ? '彻底清空' : '恢复全部',
    });
    if (!accepted || disposed || route.fullPath !== location || authUser.value?.id !== user) return;
    requested = true;
    const result =
      action === 'purge'
        ? await clearTrash(team.team_key, project)
        : await restoreAllTrash(team.team_key, project);
    if (!result.success) throw new Error('操作未完成，请刷新后重试');
    if (!disposed) notification.show(action === 'purge' ? '回收站已清空' : '恢复完成', 'success');
  } catch (cause) {
    if (!disposed && route.fullPath === location) actionError.value = errorMessage(cause);
  } finally {
    if (requested) {
      teams.invalidateProjects();
      if (!disposed && route.fullPath === location) await load();
    }
    busy.value = '';
  }
}

async function mutate(item: TrashItem, action: 'restore' | 'purge', event: Event) {
  if (
    disposed ||
    busy.value ||
    loading.value ||
    (action === 'restore' ? !item.can_restore : !item.can_purge)
  )
    return;
  const location = route.fullPath;
  const userId = authUser.value?.id;
  const trigger = event.currentTarget as HTMLElement;
  const key = rowKey(item);
  busy.value = key;
  actionError.value = '';
  let requested = false;
  try {
    if (action === 'purge') {
      const accepted = await confirm({
        type: MessageType.ERROR,
        title: item.type === 'folder' ? '彻底删除文件夹' : '彻底删除文件',
        content:
          item.type === 'folder'
            ? `彻底删除文件夹「${item.name}」及内部全部文件（当前共 ${item.document_count} 个，包含已单独移入回收站的文件）？彻底删除后无法恢复。`
            : `彻底删除「${item.name}」及其附件关联和分享？彻底删除后无法恢复。`,
        confirmText: '彻底删除',
      });
      if (!accepted) return;
    }
    if (disposed || route.fullPath !== location || authUser.value?.id !== userId) return;
    requested = true;
    const result =
      action === 'restore'
        ? await restoreTrash(item.type, item.key)
        : await purgeTrash(item.type, item.key);
    if (!result.success) throw new Error('操作未完成，请刷新后重试');
    if (!disposed && authUser.value?.id === userId)
      notification.show(action === 'restore' ? '已恢复到原目录' : '已彻底删除', 'success');
  } catch (cause) {
    if (!disposed && route.fullPath === location && authUser.value?.id === userId)
      actionError.value = errorMessage(cause);
  } finally {
    // 包括 404、409 和网络超时：重新读取服务端状态，避免盲目重试已完成的操作。
    if (requested) {
      teams.invalidateProjects();
      if (!disposed) await load();
    }
    busy.value = '';
    await nextTick();
    if (!disposed && route.fullPath === location) {
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
      else {
        const row = Array.from(
          contentElement.value?.querySelectorAll<HTMLElement>('[data-trash-key]') ?? []
        ).find((element) => element.dataset.trashKey === key);
        const button = row?.querySelector<HTMLButtonElement>('button:not(:disabled)');
        (button ?? contentElement.value)?.focus({ preventScroll: true });
      }
    }
  }
}

watch([teamKey, projectKey, limit], () => {
  actionError.value = '';
});
watch([teamKey, projectKey, limit, page, () => authUser.value?.id], load, { immediate: true });
watch(
  () => teams.projectRevision,
  () => {
    if (!busy.value) void load();
  }
);
watch(
  [loading, loadError],
  () => {
    document.title = `${loading.value ? '正在加载回收站' : loadError.value ? '回收站不可用' : '回收站'} · Voex`;
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  disposed = true;
  controller?.abort();
});
</script>

<style scoped lang="stylus">
@import '../../components/team/team.styl'

.trash-page
  position relative
  z-index 1
  display flex
  flex-direction column
  height 100%
  min-height 0
  &__header
    display flex
    align-items center
    justify-content space-between
    flex-shrink 0
    min-height 44px
    padding 6px 18px
    border-bottom 1px solid var(--color-border-translucent)
  &__title
    margin 0
    font-size 12px
    font-weight 600
  &__toolbar
    display flex
    flex-wrap wrap
    gap 12px
    padding 14px 18px 4px
  &__filter
    display flex
    align-items center
    gap 8px
    flex 1
    min-width 0
    max-width 380px
    label
      flex-shrink 0
    select
      min-width 0
      cursor pointer
      &:disabled
        cursor not-allowed
        opacity .5
    &--size
      flex 0 0 166px
  &__description, &__error
    margin 0
    padding 8px 18px
    font-size 12px
    overflow-wrap anywhere
  &__description
    color var(--color-text-tertiary)
  &__error
    color var(--color-red)
  &__content
    flex 1
    min-height 0
    overflow auto
    scrollbar-gutter stable
    padding 6px 18px
    &:focus-visible
      outline 2px solid var(--color-accent)
      outline-offset -2px
  &__state
    display flex
    flex-direction column
    align-items center
    justify-content center
    min-height 240px
    height 100%
    h2
      font-size 16px
    p
      overflow-wrap anywhere
  &__spinner
    animation trash-spin 1s linear infinite
  &__table
    width 100%
    border-collapse collapse
    table-layout fixed
    th, td
      padding 12px 8px
      text-align left
      vertical-align top
      border-bottom 1px solid var(--color-border-translucent)
      overflow-wrap anywhere
    thead th
      font-size 12px
      font-weight 500
      color var(--color-text-tertiary)
    th:first-child
      width 25%
    th:last-child
      width 190px
    tbody th
      color var(--color-text-primary)
      font-weight 500
  &__caption
    position absolute
    width 1px
    height 1px
    overflow hidden
    clip-path inset(50%)
  &__object
    display flex
    gap 8px
    align-items flex-start
    svg
      flex-shrink 0
      margin-top 2px
  &__folder
    color var(--color-accent)
  &__hint
    display block
    margin-top 4px
    font-size 12px
    font-weight 400
    color var(--color-text-tertiary)
  &__name .trash-page__hint
    padding-left 26px
  &__pagination
    flex-shrink 0
    margin 0
    padding 12px 18px
    border-top 1px solid var(--color-border-translucent)
    font-size 12px

@keyframes trash-spin
  to
    transform rotate(360deg)

@media (max-width: 900px)
  .trash-page__table
    table-layout auto

@media (max-width: 700px)
  .trash-page
    &__toolbar
      flex-direction column
    &__filter
      max-width none
      flex auto
    &__table
      display block
      thead
        position absolute
        width 1px
        height 1px
        overflow hidden
        clip-path inset(50%)
      tbody
        display block
      tr
        display grid
        gap 8px
        padding 16px 0
        border-bottom 1px solid var(--color-border-translucent)
      th, td
        display block
        width auto !important
        border 0
        padding 0
      td[data-label]::before
        content attr(data-label) '：'
        color var(--color-text-tertiary)
      .trash-page__hint
        display inline
        margin-left 8px
      .trash-page__name .trash-page__hint
        display block
        margin-left 0
      .trash-page__operation
        margin-top 4px

@media (prefers-reduced-motion: reduce)
  .trash-page__spinner
    animation none
</style>
