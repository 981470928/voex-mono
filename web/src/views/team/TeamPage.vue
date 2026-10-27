<template>
  <main class="team-page team-ui">
    <header class="team-page__header">
      <div>
        <h1>团队</h1>
        <p class="team-ui__hint">在不同团队中组织项目与协作成员。</p>
      </div>
      <div class="team-ui__actions">
        <button
          class="team-ui__button"
          type="button"
          :disabled="busy || loading || store.loading"
          @click="refreshAll"
        >
          刷新
        </button>
        <button class="team-ui__button" type="button" :disabled="busy" @click="joinOpen = true">
          加入团队
        </button>
        <button
          class="team-ui__button team-ui__button--primary"
          type="button"
          :disabled="busy"
          @click="newTeam"
        >
          创建团队
        </button>
      </div>
    </header>
    <div class="team-page__body">
      <div v-if="store.loading && !store.loaded" class="team-ui__state" role="status">
        正在加载团队…
      </div>
      <div v-if="store.error" class="team-ui__error" role="alert">
        {{ store.error }}
        <button class="team-ui__button" type="button" @click="reload">重试</button>
      </div>
      <nav class="team-page__teams" aria-label="选择团队">
        <RouterLink
          v-for="item in visibleTeams"
          :key="item.team_key"
          class="team-page__team"
          :class="{ 'team-page__team--active': item.team_key === team?.team_key }"
          :to="{
            name: 'teams',
            query: { team_key: item.team_key, teams_page: teamPage > 1 ? teamPage : undefined },
          }"
          :aria-current="item.team_key === team?.team_key ? 'page' : undefined"
        >
          <span class="team-page__team-icon"><SvgIcon name="users" :size="18" /></span>
          <span class="team-page__team-copy"
            ><strong>{{ item.name }}</strong
            ><span>{{ teamRoleLabels[item.role] }} · {{ item.member_count }} 位成员</span></span
          >
          <span v-if="item.kind === 'personal'" class="team-ui__badge">个人</span>
        </RouterLink>
      </nav>
      <div v-if="teamPages > 1" class="team-ui__pagination">
        <button
          class="team-ui__button"
          type="button"
          :disabled="teamPage <= 1"
          @click="setQuery('teams_page', teamPage - 1)"
        >
          上一页团队</button
        ><span>{{ teamPage }} / {{ teamPages }}</span
        ><button
          class="team-ui__button"
          type="button"
          :disabled="teamPage >= teamPages"
          @click="setQuery('teams_page', teamPage + 1)"
        >
          下一页团队
        </button>
      </div>
      <p v-if="store.loaded && !team" class="team-ui__error" role="alert">
        团队不存在或你已不在该团队。请重新选择团队。
      </p>
      <template v-if="team">
        <section class="team-page__detail">
          <div class="team-page__detail-heading">
            <div>
              <h2>{{ team.name }}</h2>
              <span class="team-ui__hint"
                >团队编号 {{ team.team_code }} · {{ teamRoleLabels[team.role] }}</span
              >
            </div>
            <div class="team-ui__actions">
              <button class="team-ui__button" type="button" @click="copyCode">复制编号</button
              ><RouterLink
                class="team-ui__button"
                :to="{ name: 'recent', query: { team_key: team.team_key } }"
                >返回工作台</RouterLink
              >
            </div>
          </div>
          <nav class="team-page__tabs" aria-label="团队管理">
            <RouterLink
              v-for="item in tabs"
              :key="item.key"
              :to="{ query: { ...route.query, tab: item.key, page: undefined } }"
              class="team-page__tab"
              :class="{ 'team-page__tab--active': tab === item.key }"
              :aria-current="tab === item.key ? 'page' : undefined"
              >{{ item.label
              }}<span v-if="item.key === 'requests' && pendingCount" class="team-ui__badge">{{
                pendingCount
              }}</span></RouterLink
            >
          </nav>
          <p v-if="loading" class="team-ui__state" role="status">正在加载{{ activeTabLabel }}…</p>
          <div v-else-if="loadError" class="team-ui__state" role="alert">
            <p>{{ loadError }}</p>
            <button class="team-ui__button" type="button" @click="loadDetail">重新加载</button>
          </div>
          <template v-else>
            <p v-if="actionError" class="team-ui__error" role="alert">{{ actionError }}</p>
            <section v-if="tab === 'members'" aria-label="团队成员">
              <p class="team-page__description">
                所有者与管理员可创建项目并编辑全部项目；成员默认只读，项目编辑需单独授权。
              </p>
              <ul class="team-page__rows">
                <li v-for="member in pageMembers" :key="member.user_id" class="team-page__row">
                  <img
                    v-if="member.avator && !failedAvatars.has(member.user_id)"
                    class="team-page__avatar"
                    :src="member.avator"
                    alt=""
                    width="32"
                    height="32"
                    @error="failedAvatars.add(member.user_id)"
                  />
                  <span
                    v-else
                    class="team-page__avatar team-page__avatar--fallback"
                    aria-hidden="true"
                    >{{ member.name.slice(0, 1) }}</span
                  >
                  <div class="team-page__row-copy">
                    <strong
                      >{{ member.name
                      }}<span v-if="member.user_id === authUser?.id" class="team-ui__hint"
                        >（你）</span
                      ></strong
                    ><span class="team-ui__hint"
                      >{{ teamRoleLabels[member.role] }} ·
                      {{ formatTime(member.joined_at) }} 加入</span
                    >
                  </div>
                  <div
                    v-if="team.permissions.manage && member.role !== 'owner'"
                    class="team-ui__actions"
                  >
                    <button
                      v-if="team.role === 'owner'"
                      class="team-ui__button"
                      type="button"
                      :disabled="busy"
                      @click="changeRole(member)"
                    >
                      {{ member.role === 'admin' ? '设为成员' : '设为管理员' }}
                    </button>
                    <button
                      v-if="team.role === 'owner' || member.role === 'member'"
                      class="team-ui__button team-ui__button--danger"
                      type="button"
                      :disabled="busy"
                      @click="removeMember(member)"
                    >
                      移除
                    </button>
                  </div>
                </li>
              </ul>
              <p v-if="!members.length" class="team-ui__state">暂无成员记录</p>
            </section>
            <section v-else-if="tab === 'requests'" aria-label="入队申请">
              <p class="team-page__description">
                批准后成为团队成员，获得继承团队权限的项目访问权。
              </p>
              <ul class="team-page__rows">
                <li v-for="request in pageRequests" :key="request.id" class="team-page__row">
                  <div class="team-page__row-copy">
                    <strong
                      >{{ request.name }}
                      <span class="team-ui__badge">{{
                        joinStatusLabels[request.status]
                      }}</span></strong
                    >
                    <p class="team-page__message">{{ request.message }}</p>
                    <span class="team-ui__hint">{{ formatTime(request.created_at) }}</span>
                  </div>
                  <div v-if="request.status === 'pending'" class="team-ui__actions">
                    <button
                      class="team-ui__button"
                      type="button"
                      :disabled="busy"
                      @click="review(request, 'rejected')"
                    >
                      拒绝</button
                    ><button
                      class="team-ui__button team-ui__button--primary"
                      type="button"
                      :disabled="busy"
                      @click="review(request, 'approved')"
                    >
                      批准加入
                    </button>
                  </div>
                </li>
              </ul>
              <p v-if="!requests.length" class="team-ui__state">暂无入队申请</p>
            </section>
            <section v-else-if="tab === 'invites'" aria-label="邀请链接">
              <div class="team-page__detail-heading">
                <p class="team-page__description">邀请链接用于提交申请，仍需管理员审核。</p>
                <button
                  class="team-ui__button team-ui__button--primary"
                  type="button"
                  :disabled="busy"
                  @click="newInvite"
                >
                  创建邀请链接
                </button>
              </div>
              <div v-if="newInviteLink" class="team-page__invite">
                <label for="team-invite-link">新邀请链接（仅本次可复制）</label>
                <input
                  id="team-invite-link"
                  class="team-ui__input"
                  :type="revealInvite ? 'text' : 'password'"
                  :value="newInviteLink"
                  readonly
                  autocomplete="off"
                  @focus="($event.target as HTMLInputElement).select()"
                />
                <div class="team-ui__actions">
                  <button
                    class="team-ui__button"
                    type="button"
                    :aria-pressed="revealInvite"
                    @click="revealInvite = !revealInvite"
                  >
                    {{ revealInvite ? '隐藏链接' : '显示链接' }}</button
                  ><button class="team-ui__button" type="button" @click="copyInvite">
                    复制链接
                  </button>
                </div>
                <p class="team-ui__hint">复制失败时可显示并手动复制。离开页面后不会保留此链接。</p>
              </div>
              <ul class="team-page__rows">
                <li v-for="invite in pageInvites" :key="invite.id" class="team-page__row">
                  <div class="team-page__row-copy">
                    <strong>{{ invite.revoked_at ? '已撤销的邀请' : '有效邀请' }}</strong
                    ><span class="team-ui__hint">创建于 {{ formatTime(invite.created_at) }}</span>
                  </div>
                  <button
                    v-if="!invite.revoked_at"
                    class="team-ui__button team-ui__button--danger"
                    type="button"
                    :disabled="busy"
                    @click="revokeInvite(invite)"
                  >
                    撤销链接
                  </button>
                </li>
              </ul>
              <p v-if="!invites.length" class="team-ui__state">尚未创建邀请链接</p>
            </section>
            <section v-else class="team-page__settings" aria-label="团队设置">
              <div class="team-page__row">
                <div class="team-page__row-copy">
                  <strong>团队名称</strong><span class="team-ui__hint">{{ team.name }}</span>
                </div>
                <button
                  v-if="team.permissions.manage"
                  class="team-ui__button"
                  type="button"
                  :disabled="busy"
                  @click="editName"
                >
                  修改名称
                </button>
              </div>
              <p v-if="team.kind === 'personal'" class="team-page__description">
                这是个人团队，可以邀请成员与协作。个人团队不能删除或转让。
              </p>
              <template v-if="team.permissions.transfer && team.kind !== 'personal'">
                <div class="team-ui__field">
                  <label for="team-transfer">新的所有者</label
                  ><select
                    id="team-transfer"
                    v-model="transferTo"
                    class="team-ui__input"
                    :disabled="busy"
                  >
                    <option value="">选择团队成员</option>
                    <option
                      v-for="member in transferCandidates"
                      :key="member.user_id"
                      :value="member.user_id"
                    >
                      {{ member.name }} · {{ teamRoleLabels[member.role] }}
                    </option></select
                  ><span class="team-ui__hint">转让后，该成员获得所有者身份。</span>
                </div>
                <button
                  class="team-ui__button team-ui__button--danger"
                  type="button"
                  :disabled="busy || !transferTo"
                  @click="transfer"
                >
                  转让团队
                </button>
              </template>
              <div class="team-page__danger-zone">
                <button
                  v-if="team.role !== 'owner'"
                  class="team-ui__button team-ui__button--danger"
                  type="button"
                  :disabled="busy"
                  @click="leave"
                >
                  退出团队</button
                ><button
                  v-if="team.role === 'owner' && team.kind !== 'personal'"
                  class="team-ui__button team-ui__button--danger"
                  type="button"
                  :disabled="busy"
                  @click="destroy"
                >
                  删除团队
                </button>
                <p v-if="team.role === 'owner' && team.kind !== 'personal'" class="team-ui__hint">
                  只有不含项目的团队可以删除。已有文件不会被批量删除。
                </p>
              </div>
            </section>
            <nav
              v-if="tab !== 'settings' && pages > 1"
              class="team-ui__pagination"
              aria-label="团队记录分页"
            >
              <button
                class="team-ui__button"
                type="button"
                :disabled="page <= 1 || busy"
                @click="setQuery('page', page - 1)"
              >
                上一页</button
              ><span>第 {{ page }} / {{ pages }} 页 · {{ total }} 条</span
              ><button
                class="team-ui__button"
                type="button"
                :disabled="page >= pages || busy"
                @click="setQuery('page', page + 1)"
              >
                下一页
              </button>
            </nav>
          </template>
        </section>
      </template>
      <section class="team-page__my-requests">
        <h2>我的入队申请</h2>
        <p v-if="myError" class="team-ui__error" role="alert">
          {{ myError }}
          <button class="team-ui__button" type="button" @click="loadMine">重试</button>
        </p>
        <p v-else-if="myLoading" class="team-ui__hint" role="status">正在加载申请…</p>
        <p v-else-if="!myRequests.length" class="team-ui__hint">尚未提交入队申请。</p>
        <ul class="team-page__rows">
          <li v-for="request in pageMine" :key="request.id" class="team-page__row">
            <div class="team-page__row-copy">
              <strong>{{ request.team_name }}</strong
              ><span class="team-ui__hint">{{ formatTime(request.created_at) }}</span>
            </div>
            <span class="team-ui__badge">{{ joinStatusLabels[request.status] }}</span>
          </li>
        </ul>
        <nav v-if="myPages > 1" class="team-ui__pagination" aria-label="我的申请分页">
          <button
            class="team-ui__button"
            type="button"
            :disabled="myPage <= 1"
            @click="setQuery('my_page', myPage - 1)"
          >
            上一页</button
          ><span>{{ myPage }} / {{ myPages }}</span
          ><button
            class="team-ui__button"
            type="button"
            :disabled="myPage >= myPages"
            @click="setQuery('my_page', myPage + 1)"
          >
            下一页
          </button>
        </nav>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import SvgIcon from '@/components/SvgIcon.vue';
import { useTeamStore } from '@/stores/team';
import { useModalStore, ModalType } from '@/stores/modal';
import { useNotificationStore } from '@/stores/notification';
import { useConfirm } from '@/composables/useConfirm';
import { useDialog } from '@/composables/useDialog';
import { authUser } from '@/service/auth-session';
import { errorMessage } from '@/utils/error';
import { formatTime } from '@/utils/workspace';
import { MessageType } from '@/constant/status';
import {
  createTeam,
  renameTeam,
  deleteTeam,
  transferTeam,
  getTeamMembers,
  setTeamRole,
  removeTeamMember,
  getTeamInvites,
  createTeamInvite,
  revokeTeamInvite,
  getMyJoinRequests,
  getTeamJoinRequests,
  reviewJoinRequest,
  teamRoleLabels,
  joinStatusLabels,
  type TeamMember,
  type TeamInvite,
  type JoinRequest,
} from '@/service/api/team-api';
const route = useRoute();
const router = useRouter();
const store = useTeamStore();
const modal = useModalStore();
const notification = useNotificationStore();
const { confirm } = useConfirm();
const team = computed(() =>
  store.resolve(typeof route.query.team_key === 'string' ? route.query.team_key : undefined)
);
const members = ref<TeamMember[]>([]);
const requests = ref<JoinRequest[]>([]);
const invites = ref<TeamInvite[]>([]);
const myRequests = ref<JoinRequest[]>([]);
const loading = ref(false);
const busy = ref(false);
const loadError = ref('');
const actionError = ref('');
const myError = ref('');
const myLoading = ref(false);
const joinOpen = ref(false);
useDialog(ModalType.JOIN_TEAM_DIALOG, {
  visible: () => joinOpen.value,
  props: () => ({ onApplied: loadMine }),
  onClose: () => {
    joinOpen.value = false;
  },
});
const newInviteLink = ref('');
const revealInvite = ref(false);
const transferTo = ref('');
const failedAvatars = ref(new Set<string>());
const tabs = computed(() => [
  { key: 'members', label: '成员' },
  ...(team.value?.permissions.manage
    ? [
        { key: 'requests', label: '入队申请' },
        { key: 'invites', label: '邀请链接' },
      ]
    : []),
  { key: 'settings', label: '设置' },
]);
const tab = computed(
  () => tabs.value.find((item) => item.key === route.query.tab)?.key ?? 'members'
);
const activeTabLabel = computed(() => tabs.value.find((item) => item.key === tab.value)?.label);
const pendingCount = computed(
  () => requests.value.filter((item) => item.status === 'pending').length
);
const transferCandidates = computed(() => members.value.filter((item) => item.role !== 'owner'));
const PAGE_SIZE = 20;
const pageValue = (name: string, max: number) =>
  Math.min(max, Math.max(1, Math.floor(Number(route.query[name])) || 1));
const teamPages = computed(() => Math.max(1, Math.ceil(store.teams.length / PAGE_SIZE)));
const teamPage = computed(() => pageValue('teams_page', teamPages.value));
const visibleTeams = computed(() =>
  store.teams.slice((teamPage.value - 1) * PAGE_SIZE, teamPage.value * PAGE_SIZE)
);
const total = computed(() =>
  tab.value === 'members'
    ? members.value.length
    : tab.value === 'requests'
      ? requests.value.length
      : invites.value.length
);
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const page = computed(() => pageValue('page', pages.value));
const pageMembers = computed(() =>
  members.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
);
const pageRequests = computed(() =>
  requests.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
);
const pageInvites = computed(() =>
  invites.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
);
const myPages = computed(() => Math.max(1, Math.ceil(myRequests.value.length / PAGE_SIZE)));
const myPage = computed(() => pageValue('my_page', myPages.value));
const pageMine = computed(() =>
  myRequests.value.slice((myPage.value - 1) * PAGE_SIZE, myPage.value * PAGE_SIZE)
);
let controller: AbortController | undefined;
let mineController: AbortController | undefined;
let active = true;
function setQuery(key: string, value: number) {
  void router.replace({ query: { ...route.query, [key]: value > 1 ? String(value) : undefined } });
}
async function reload() {
  try {
    await store.refresh();
    await loadDetail();
  } catch {
    /* Store exposes retryable error. */
  }
}
function refreshAll() {
  void reload();
  void loadMine();
}
async function loadDetail() {
  controller?.abort();
  const selected = team.value;
  if (!selected) return;
  controller = new AbortController();
  const signal = controller.signal;
  loading.value = true;
  loadError.value = '';
  actionError.value = '';
  try {
    const result = await Promise.all([
      getTeamMembers(selected.team_key, signal),
      selected.permissions.manage
        ? getTeamJoinRequests(selected.team_key, signal)
        : Promise.resolve([]),
      selected.permissions.manage ? getTeamInvites(selected.team_key, signal) : Promise.resolve([]),
    ]);
    if (signal.aborted) return;
    [members.value, requests.value, invites.value] = result;
  } catch (cause) {
    if (!signal.aborted) loadError.value = errorMessage(cause, '团队详情加载失败');
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
async function loadMine() {
  mineController?.abort();
  mineController = new AbortController();
  const signal = mineController.signal;
  myLoading.value = true;
  myError.value = '';
  try {
    const result = await getMyJoinRequests(signal);
    if (!signal.aborted) myRequests.value = result;
  } catch (cause) {
    if (!signal.aborted) myError.value = errorMessage(cause, '申请记录加载失败');
  } finally {
    if (!signal.aborted) myLoading.value = false;
  }
}
async function mutate(
  title: string,
  content: string,
  action: (key: string) => Promise<unknown>,
  danger = false
) {
  const selected = team.value;
  if (!selected || busy.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    if (
      !(await confirm({
        title,
        content,
        confirmText: title,
        type: danger ? MessageType.ERROR : MessageType.INFO,
      }))
    )
      return;
    await action(selected.team_key);
    if (!active) return;
    notification.show(`${title}已完成`, 'success');
    try {
      await store.refresh();
    } catch {
      /* Store error remains visible. */
    }
    store.invalidateProjects();
    await loadDetail();
  } catch (cause) {
    if (active) actionError.value = errorMessage(cause, `${title}未完成，请重试`);
  } finally {
    busy.value = false;
  }
}
function newTeam() {
  modal.showModal(ModalType.INPUT_DIALOG, {
    title: '创建团队',
    tips: '团队名称',
    okText: '创建',
    onOK: async (name) => {
      const created = await createTeam(name);
      notification.show('团队已创建', 'success');
      try {
        await store.refresh();
        await router.push({ name: 'teams', query: { team_key: created.team_key } });
      } catch {
        notification.show('团队已创建，请重新加载团队列表', 'info');
      }
    },
  });
}
function editName() {
  const selected = team.value;
  if (!selected?.permissions.manage) return;
  modal.showModal(ModalType.INPUT_DIALOG, {
    title: '修改团队名称',
    tips: '团队名称',
    defaultValue: selected.name,
    okText: '保存',
    onOK: async (name) => {
      await renameTeam(selected.team_key, name);
      notification.show('团队名称已保存', 'success');
      try {
        await store.refresh();
      } catch {
        /* Store exposes failure. */
      }
    },
  });
}
function changeRole(member: TeamMember) {
  const role = member.role === 'admin' ? 'member' : 'admin';
  void mutate(
    `设为${teamRoleLabels[role]}`,
    `将「${member.name}」设为${teamRoleLabels[role]}？${role === 'admin' ? '该成员将获得团队全部项目的编辑权限、成员管理和申请审核权限。' : '该成员将不再拥有管理员权限。'}`,
    (key) => setTeamRole(key, member.user_id, role)
  );
}
function removeMember(member: TeamMember) {
  void mutate(
    '移除成员',
    `将「${member.name}」移出团队？该成员将失去团队和项目授权。`,
    (key) => removeTeamMember(key, member.user_id),
    true
  );
}
function review(request: JoinRequest, status: 'approved' | 'rejected') {
  void mutate(
    status === 'approved' ? '批准加入' : '拒绝申请',
    `${status === 'approved' ? '批准' : '拒绝'}「${request.name}」加入「${team.value?.name}」的申请？`,
    (key) => reviewJoinRequest(key, request.id, status)
  );
}
async function newInvite() {
  if (!team.value?.permissions.manage || busy.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    const result = await createTeamInvite(team.value.team_key);
    if (!active) return;
    newInviteLink.value = new URL(
      router.resolve({ name: 'join', hash: `#${result.token}` }).href,
      location.origin
    ).href;
    revealInvite.value = false;
    notification.show('邀请链接已创建', 'success');
    await loadDetail();
  } catch (cause) {
    actionError.value = errorMessage(cause, '创建邀请未完成，请重试');
  } finally {
    busy.value = false;
  }
}
function revokeInvite(invite: TeamInvite) {
  void mutate(
    '撤销链接',
    '撤销此邀请链接？链接将不能再用于提交申请，已有申请和成员不受影响。',
    (key) => revokeTeamInvite(key, invite.id),
    true
  );
}
async function copyValue(value: string, fallback: string) {
  try {
    await navigator.clipboard.writeText(value);
    notification.show('已复制', 'success');
  } catch {
    actionError.value = fallback;
  }
}
function copyCode() {
  if (team.value) void copyValue(team.value.team_code, '复制失败，请手动选择团队编号复制。');
}
function copyInvite() {
  void copyValue(newInviteLink.value, '复制失败，请显示链接后手动选择复制。');
}
function transfer() {
  const member = members.value.find((item) => item.user_id === transferTo.value);
  if (!member || !team.value?.permissions.transfer) return;
  void mutate(
    '转让团队',
    `将「${team.value.name}」转让给「${member.name}」？你将失去所有者身份。`,
    (key) => transferTeam(key, member.user_id),
    true
  );
}
function leave() {
  void mutate(
    '退出团队',
    `退出「${team.value?.name}」？你将失去团队和项目授权，再次加入需要重新申请。`,
    (key) => removeTeamMember(key, 'me'),
    true
  );
}
function destroy() {
  if (team.value?.kind === 'personal') return;
  void mutate(
    '删除团队',
    `删除「${team.value?.name}」？仅允许删除没有项目的团队，成员关系与邀请也将一并移除。`,
    (key) => deleteTeam(key),
    true
  );
}
watch(
  () => team.value?.team_key,
  () => {
    newInviteLink.value = '';
    revealInvite.value = false;
    transferTo.value = '';
    members.value = [];
    requests.value = [];
    invites.value = [];
    void loadDetail();
  },
  { immediate: true }
);
onMounted(() => {
  void reload();
  void loadMine();
  document.title = '团队 · Voex';
});
onBeforeRouteLeave(() => !busy.value);
onBeforeRouteUpdate(() => !busy.value);
onBeforeUnmount(() => {
  active = false;
  controller?.abort();
  mineController?.abort();
});
</script>

<style scoped lang="stylus">
@import '../../components/team/team.styl'
.team-page
  position relative
  z-index 1
  display flex
  flex-direction column
  min-height 0
  height 100%
  overflow hidden
.team-page__header
  display flex
  flex-shrink 0
  align-items center
  justify-content space-between
  gap 16px
  padding 22px 24px
  border-bottom 1px solid var(--color-border-translucent)
  h1
    margin 0
    font-size 20px
    color var(--color-text-primary)
  p
    margin 5px 0 0
.team-page__body
  min-height 0
  overflow auto
  scrollbar-gutter stable
  padding 24px
.team-page__teams
  display grid
  grid-template-columns repeat(auto-fill, minmax(230px, 1fr))
  gap 10px
  margin-bottom 28px
.team-page__team
  display flex
  align-items center
  gap 10px
  min-height 72px
  padding 12px
  border 1px solid var(--color-border-translucent-strong)
  border-radius 8px
  color inherit
  text-decoration none
  &:hover
    background var(--color-bg-translucent)
  &:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset 2px
  &:active
    opacity .8
  &--active
    background var(--color-bg-translucent)
    border-color var(--color-accent)
.team-page__team-icon
  display grid
  place-items center
  width 30px
  height 30px
  flex-shrink 0
  color var(--color-text-secondary)
.team-page__team-copy, .team-page__row-copy
  display flex
  flex-direction column
  gap 3px
  min-width 0
  flex 1
  overflow-wrap anywhere
  strong
    color var(--color-text-primary)
    font-weight 500
.team-page__team-copy
  strong
    white-space nowrap
    overflow hidden
    text-overflow ellipsis
  > span
    font-size 11px
    color var(--color-text-tertiary)
.team-page__detail-heading
  display flex
  justify-content space-between
  align-items center
  flex-wrap wrap
  gap 12px
  h2
    margin 0 0 4px
    font-size 17px
    color var(--color-text-primary)
    overflow-wrap anywhere
.team-page__tabs
  display flex
  gap 20px
  flex-wrap wrap
  margin-top 20px
  border-bottom 1px solid var(--color-border-translucent-strong)
.team-page__tab
  display flex
  align-items center
  gap 6px
  padding 10px 0
  border-bottom 2px solid transparent
  color var(--color-text-tertiary)
  text-decoration none
  &:hover
    color var(--color-text-primary)
  &:focus-visible
    outline 2px solid var(--color-accent)
  &--active
    color var(--color-text-primary)
    border-bottom-color var(--color-accent)
.team-page__description
  margin 18px 0
  color var(--color-text-tertiary)
  font-size 12px
.team-page__rows
  list-style none
  padding 0
  margin 0
.team-page__row
  display flex
  align-items center
  gap 12px
  padding 16px 0
  border-bottom 1px solid var(--color-border-translucent)
.team-page__avatar
  width 32px
  height 32px
  flex-shrink 0
  border-radius 50%
  object-fit cover
  &--fallback
    display grid
    place-items center
    background var(--color-bg-translucent)
.team-page__message
  margin 6px 0
  white-space pre-wrap
.team-page__invite
  display grid
  gap 8px
  padding 16px
  border 1px solid var(--color-border-translucent-strong)
  border-radius 8px
  margin 16px 0
.team-page__settings
  max-width 640px
  padding-bottom 20px
.team-page__danger-zone
  margin-top 28px
  padding-top 20px
  border-top 1px solid var(--color-border-translucent-strong)
.team-page__my-requests
  margin-top 36px
  h2
    color var(--color-text-primary)
    font-size 16px
    font-weight 500
@media (max-width: 700px)
  .team-page__header
    flex-wrap wrap
    padding 16px
  .team-page__body
    padding 16px
  .team-page__row
    flex-wrap wrap
  .team-page__row > .team-ui__actions
    flex-basis 100%
    padding-left 44px
</style>
