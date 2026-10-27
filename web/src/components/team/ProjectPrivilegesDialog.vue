<template>
  <VoexModal
    :model-value="modelValue"
    title="项目访问权限"
    :width="480"
    :busy="saving"
    :mask-closable="false"
    @close="close"
  >
    <div class="team-ui project-access">
      <p class="project-access__name">{{ project.name }}</p>
      <p v-if="loading" class="team-ui__state" role="status">正在加载团队成员…</p>
      <template v-else-if="!loadError">
        <p class="team-ui__hint">
          团队所有者和管理员始终可以编辑此项目。文件夹继承项目权限；文件分享单独生效。
        </p>
        <div>
          <p class="team-ui__hint">
            {{ selected.length }} 位成员已选择。空名单表示普通成员只读，所有者与管理员可编辑。
          </p>
          <div class="project-access__members">
            <label v-for="member in members" :key="member.user_id" class="project-access__member"
              ><input
                v-if="member.role === 'member'"
                v-model="selected"
                type="checkbox"
                :value="member.user_id"
                :disabled="saving"
              /><input v-else type="checkbox" checked disabled /><span>{{ member.name }}</span
              ><span class="team-ui__badge">{{ teamRoleLabels[member.role] }}</span></label
            >
          </div>
        </div>
      </template>
      <p class="team-ui__error" role="alert">{{ loadError || error }}</p>
      <div class="team-ui__actions">
        <button class="team-ui__button" type="button" :disabled="saving" @click="close">取消</button
        ><button v-if="loadError" class="team-ui__button" type="button" @click="load">重试</button
        ><button
          v-else
          class="team-ui__button team-ui__button--primary"
          type="button"
          :disabled="saving || loading || !dirty"
          :aria-busy="saving"
          @click="save"
        >
          保存权限
        </button>
      </div>
    </div>
  </VoexModal>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter, type RouteLocationNormalized } from 'vue-router';
import { VoexModal } from '@/plugins/voex-modal';
import { getTeamMembers, teamRoleLabels, type TeamMember } from '@/service/api/team-api';
import {
  getProjectPrivileges,
  setProjectPrivileges,
  type ProjectInfo,
  type ProjectPrivileges,
} from '@/service/api/workspace-api';
import { useConfirm } from '@/composables/useConfirm';
import { useNotificationStore } from '@/stores/notification';
import { errorMessage } from '@/utils/error';
const props = defineProps<{ modelValue: boolean; project: ProjectInfo }>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [] }>();
const { confirm } = useConfirm();
const router = useRouter();
const notification = useNotificationStore();
const members = ref<TeamMember[]>([]);
const mode = ref<ProjectPrivileges['mode']>('restricted');
const selected = ref<string[]>([]);
const original = ref('');
const loading = ref(false);
const saving = ref(false);
const loadError = ref('');
const error = ref('');
const snapshot = computed(() =>
  JSON.stringify({
    mode: mode.value,
    user_ids: mode.value === 'restricted' ? [...selected.value].sort() : [],
  })
);
const dirty = computed(() => !!original.value && snapshot.value !== original.value);
let controller: AbortController | undefined;
let active = true;
async function load() {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  loading.value = true;
  loadError.value = '';
  error.value = '';
  original.value = '';
  try {
    const [list, privileges] = await Promise.all([
      getTeamMembers(props.project.team_key, signal),
      getProjectPrivileges(props.project.project_key, signal),
    ]);
    if (signal.aborted) return;
    members.value = list;
    mode.value = 'restricted';
    selected.value = (privileges.user_ids ?? []).filter((id) =>
      list.some((member) => member.user_id === id && member.role === 'member')
    );
    original.value = snapshot.value;
  } catch (cause) {
    if (!signal.aborted) loadError.value = errorMessage(cause, '项目权限加载失败');
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
async function canLeave() {
  return (
    !saving.value &&
    (!props.modelValue ||
      !dirty.value ||
      (await confirm({
        title: '放弃权限修改',
        content: '尚未保存的项目权限修改将丢失。',
        confirmText: '放弃',
        cancelText: '继续编辑',
      })))
  );
}
async function close() {
  if (await canLeave()) emit('update:modelValue', false);
}
async function save() {
  if (saving.value || !dirty.value) return;
  saving.value = true;
  error.value = '';
  try {
    if (
      !(await confirm({
        title: '保存项目权限',
        content: `仅允许指定的 ${selected.value.length} 位成员及所有者、管理员编辑此项目。其他团队成员保留只读权限，已有文件授权继续生效。`,
        confirmText: '保存权限',
      }))
    )
      return;
    await setProjectPrivileges(props.project.project_key, {
      mode: mode.value,
      user_ids: mode.value === 'restricted' ? selected.value : [],
    });
    if (!active) return;
    original.value = snapshot.value;
    notification.show('项目权限已保存', 'success');
    emit('saved');
    emit('update:modelValue', false);
  } catch (cause) {
    if (active) error.value = errorMessage(cause, '项目权限保存失败');
  } finally {
    saving.value = false;
  }
}
watch(
  () => props.modelValue,
  (open) => {
    if (open) void load();
    else controller?.abort();
  },
  { immediate: true }
);
let approvedNavigation: RouteLocationNormalized | undefined;
const removeBeforeEach = router.beforeEach(async (to) => {
  if (!props.modelValue) return;
  if (!(await canLeave())) return false;
  approvedNavigation = to;
});
const removeAfterEach = router.afterEach((to, _from, failure) => {
  if (approvedNavigation !== to) return;
  approvedNavigation = undefined;
  if (!failure && props.modelValue) emit('update:modelValue', false);
});
function beforeUnload(event: BeforeUnloadEvent) {
  if (props.modelValue && (dirty.value || saving.value)) {
    event.preventDefault();
    event.returnValue = '';
  }
}
window.addEventListener('beforeunload', beforeUnload);
onBeforeUnmount(() => {
  removeBeforeEach();
  removeAfterEach();
  active = false;
  controller?.abort();
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>
<style scoped lang="stylus">
@import './team.styl'
.project-access__name
  color var(--color-text-primary)
  font-weight 500
  overflow-wrap anywhere
.project-access__modes
  display grid
  gap 12px
  border 0
  padding 0
  margin 20px 0
  legend
    margin-bottom 12px
  label
    display flex
    align-items center
    gap 8px
    cursor pointer
.project-access__members
  max-height 280px
  overflow auto
  scrollbar-gutter stable
.project-access__member
  display flex
  align-items center
  gap 8px
  padding 10px 0
  border-bottom 1px solid var(--color-border-translucent)
  cursor pointer
  > span:first-of-type
    flex 1
    overflow-wrap anywhere
.project-access input
  accent-color var(--color-accent)
  &:focus-visible
    outline 2px solid var(--color-accent)
    outline-offset 2px
</style>
