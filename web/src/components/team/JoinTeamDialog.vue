<template>
  <VoexModal
    :model-value="modelValue"
    title="申请加入团队"
    :width="460"
    :busy="submitting"
    :mask-closable="false"
    @close="close"
  >
    <form class="team-ui" novalidate @submit.prevent="submit">
      <p v-if="loading" role="status">正在读取邀请…</p>
      <p v-else-if="inviteTeam">申请加入「{{ inviteTeam.name }}」</p>
      <div v-if="!inviteToken" class="team-ui__field">
        <label :for="`${id}-code`">团队编号</label>
        <input
          :id="`${id}-code`"
          ref="codeInput"
          v-model="code"
          class="team-ui__input"
          type="text"
          autocomplete="off"
          :readonly="submitting"
          :aria-invalid="invalid === 'code' ? true : undefined"
          :aria-describedby="`${id}-error`"
          @compositionstart="composing = true"
          @compositionend="endComposition"
        />
      </div>
      <div class="team-ui__field">
        <label :for="`${id}-message`">申请信息</label>
        <textarea
          :id="`${id}-message`"
          ref="messageInput"
          v-model="message"
          class="team-ui__input"
          rows="5"
          style="resize: none"
          maxlength="1000"
          :readonly="submitting"
          :aria-invalid="invalid === 'message' ? true : undefined"
          :aria-describedby="`${id}-error`"
          placeholder="介绍自己，以及希望加入团队的原因"
          @compositionstart="composing = true"
          @compositionend="endComposition"
        />
      </div>
      <p class="team-ui__hint">提交后等待团队所有者或管理员审核。</p>
      <p :id="`${id}-error`" class="team-ui__error" role="alert">{{ error }}</p>
      <div class="team-ui__actions">
        <button class="team-ui__button" type="button" :disabled="submitting" @click="close">
          取消
        </button>
        <button
          class="team-ui__button team-ui__button--primary"
          type="submit"
          :disabled="submitting || loading || (!!inviteToken && !inviteTeam)"
          :aria-busy="submitting"
        >
          {{ submitting ? '正在提交' : '提交申请' }}
        </button>
      </div>
    </form>
  </VoexModal>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, useId, watch } from 'vue';
import { useRouter, type RouteLocationNormalized } from 'vue-router';
import { VoexModal } from '@/plugins/voex-modal';
import {
  applyToTeam,
  inspectTeamInvite,
  type InviteTeam,
  type JoinRequest,
} from '@/service/api/team-api';
import { useConfirm } from '@/composables/useConfirm';
import { useNotificationStore } from '@/stores/notification';
import { errorMessage } from '@/utils/error';
const props = withDefaults(defineProps<{ modelValue: boolean; inviteToken?: string }>(), {
  inviteToken: '',
});
const emit = defineEmits<{ 'update:modelValue': [boolean]; applied: [JoinRequest] }>();
const id = useId();
const { confirm } = useConfirm();
const router = useRouter();
const notification = useNotificationStore();
const code = ref('');
const message = ref('');
const error = ref('');
const invalid = ref('');
const composing = ref(false);
let endedAt = -Infinity;
const loading = ref(false);
const submitting = ref(false);
const inviteTeam = ref<InviteTeam>();
const codeInput = ref<HTMLInputElement>();
const messageInput = ref<HTMLTextAreaElement>();
let controller: AbortController | undefined;
let active = true;
watch(
  () => [props.modelValue, props.inviteToken] as const,
  async ([open, token]) => {
    controller?.abort();
    if (!open) return;
    code.value = '';
    message.value = '';
    error.value = '';
    invalid.value = '';
    inviteTeam.value = undefined;
    loading.value = !!token;
    if (!token) return;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      const team = await inspectTeamInvite(token, signal);
      if (!signal.aborted) inviteTeam.value = team;
    } catch (cause) {
      if (!signal.aborted) error.value = errorMessage(cause, '邀请已失效或无法读取');
    } finally {
      if (!signal.aborted) loading.value = false;
    }
  },
  { immediate: true }
);
function endComposition() {
  composing.value = false;
  endedAt = performance.now();
}
async function canLeave() {
  if (submitting.value) return false;
  return (
    !props.modelValue ||
    (!message.value && !code.value) ||
    confirm({
      title: '放弃申请信息',
      content: '尚未提交的申请信息将丢失。',
      confirmText: '放弃',
      cancelText: '继续填写',
    })
  );
}
async function close() {
  if (await canLeave()) emit('update:modelValue', false);
}
async function submit() {
  if (submitting.value || loading.value || composing.value || performance.now() - endedAt < 50)
    return;
  invalid.value = '';
  if (!props.inviteToken && !code.value.trim()) {
    invalid.value = 'code';
    error.value = '请输入团队编号';
    codeInput.value?.focus();
    return;
  }
  if (!message.value.trim()) {
    invalid.value = 'message';
    error.value = '请填写申请信息';
    messageInput.value?.focus();
    return;
  }
  submitting.value = true;
  error.value = '';
  try {
    const request = await applyToTeam({
      ...(props.inviteToken
        ? { invite_token: props.inviteToken }
        : { team_code: code.value.trim() }),
      message: message.value.trim(),
    });
    if (!active) return;
    message.value = '';
    code.value = '';
    notification.show('申请已提交，等待管理员审核', 'success');
    emit('applied', request);
    emit('update:modelValue', false);
  } catch (cause) {
    if (active) error.value = errorMessage(cause, '申请未完成，请重试');
  } finally {
    submitting.value = false;
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (props.modelValue && (message.value || code.value || submitting.value)) {
    event.preventDefault();
    event.returnValue = '';
  }
}
window.addEventListener('beforeunload', beforeUnload);
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
</style>
