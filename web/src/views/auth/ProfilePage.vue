<template>
  <AuthLayout title="帐号" description="管理你的档案、登录信息和设备" wide embedded>
    <form class="auth-form" novalidate :aria-busy="busy || loading" @submit.prevent>
      <p v-if="loading" class="profile-page__status" role="status">正在加载资料…</p>
      <button
        v-if="loadFailed"
        class="auth-form__link"
        type="button"
        :disabled="loading"
        @click="load"
      >
        重新加载资料
      </button>
      <div class="profile-page__header">
        <div class="profile-page__account">
          <span class="profile-page__account-tips">账号</span>
          <p class="profile-page__account-value">
            <span>{{ authUser?.account }}</span>
            <button
              class="profile-page__copy"
              type="button"
              aria-label="复制账号"
              :disabled="!authUser?.account"
              @click="copyAccount"
            >
              复制
            </button>
          </p>
        </div>
        <AvatorPicker
          :model-value="avator"
          :current="authUser?.avator"
          :loading="loading || savingAvator"
          :disabled="busy || loading || loadFailed || signingOut"
          @update:model-value="chooseAvator"
          @error="error = $event"
        />
      </div>
      <ProfileFields
        :model-value="profile"
        :errors="errors"
        :hints="hints"
        :disabled="loading || loadFailed || signingOut"
        @update:model-value="editProfile"
        @blur="saveField"
        @composition="onComposition"
      />
      <p class="auth-form__error" role="alert">{{ error }}</p>
    </form>
    <div class="profile-page__logout">
      <button type="button" class="auth-form__link" :disabled="busy || signingOut" @click="signOut">
        {{ signingOut ? '正在退出…' : '退出登录' }}
      </button>
    </div>
  </AuthLayout>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AuthLayout from '@/components/auth/AuthLayout.vue';
import ProfileFields from '@/components/auth/ProfileFields.vue';
import AvatorPicker from '@/components/auth/AvatorPicker.vue';
import { authUser } from '@/service/auth-session';
import { getProfile, logout, updateProfile, type ProfileInput } from '@/service/api/auth-api';
import { uploadAsset } from '@/service/api/upload-api';
import { profileErrors } from '@/utils/auth';
import { errorMessage } from '@/utils/error';
import { useConfirm } from '@/composables/useConfirm';
import { useNotificationStore } from '@/stores/notification';

const router = useRouter();
const { confirm } = useConfirm();
const notification = useNotificationStore();
type Fields = Pick<ProfileInput, 'name' | 'email' | 'phone'>;
type Field = keyof Fields;
type Change = { field: Field; value: string; revision: number } | { field: 'avator'; value: File };
const fields: Field[] = ['name', 'email', 'phone'];
const profile = ref<Fields>({ name: '', email: '', phone: '' });
const saved = ref<ProfileInput>({ name: '', email: '', phone: '', avator: '' });
const avator = ref<File | null>(null);
const errors = reactive({ name: '', email: '', phone: '' });
const hints = reactive({ name: '', email: '', phone: '' });
const revisions = { name: 0, email: 0, phone: 0 };
const busy = ref(false);
const loading = ref(false);
const loadFailed = ref(false);
const signingOut = ref(false);
const savingAvator = ref(false);
const composing = ref(false);
const error = ref('');
const pending = new Map<Change['field'], Change>();
let saveRequest: Promise<void> | undefined;
let activeChange: Change | undefined;
let deferredField: Field | undefined;
let controller: AbortController | undefined;
let disposed = false;
function populate() {
  const user = authUser.value;
  profile.value = { name: user?.name ?? '', email: user?.email ?? '', phone: user?.phone ?? '' };
  saved.value = { ...profile.value, avator: user?.avator ?? '' };
}
populate();
async function copyAccount() {
  const account = authUser.value?.account;
  if (!account) return;
  try {
    await navigator.clipboard.writeText(account);
    notification.show('账号已复制', 'success');
  } catch {
    notification.show('复制失败，请手动选择账号复制', 'error');
  }
}
async function load() {
  loading.value = true;
  loadFailed.value = false;
  error.value = '';
  try {
    await getProfile();
    if (!disposed) populate();
  } catch (cause) {
    if (!disposed) {
      error.value = errorMessage(cause, '资料加载失败');
      loadFailed.value = true;
    }
  } finally {
    loading.value = false;
  }
}
function editProfile(value: Fields) {
  for (const field of fields) {
    if (value[field] === profile.value[field]) continue;
    errors[field] = '';
    hints[field] = '';
    revisions[field] += 1;
    pending.delete(field);
  }
  profile.value = value;
}
function saveField(field: Field) {
  if (loading.value || loadFailed.value || signingOut.value || disposed) return;
  if (composing.value) {
    deferredField = field;
    return;
  }
  errors[field] = profileErrors(profile.value)[field];
  if (errors[field]) return;
  const value = field === 'name' ? profile.value[field].trim() : profile.value[field];
  if (value === saved.value[field] && activeChange?.field !== field) {
    profile.value[field] = value;
    return;
  }
  if (
    activeChange?.field === field &&
    activeChange.value === profile.value[field] &&
    activeChange.revision === revisions[field]
  )
    return;
  hints[field] = '等待保存…';
  enqueue({ field, value: profile.value[field], revision: revisions[field] });
}
async function onComposition(value: boolean) {
  composing.value = value;
  if (value || !deferredField) return;
  const field = deferredField;
  deferredField = undefined;
  await nextTick();
  saveField(field);
}
function chooseAvator(file: File) {
  if (busy.value || loading.value || loadFailed.value || signingOut.value || disposed) return;
  avator.value = file;
  error.value = '';
  savingAvator.value = true;
  enqueue({ field: 'avator', value: file });
}
function enqueue(change: Change) {
  pending.set(change.field, change);
  if (saveRequest) return;
  busy.value = true;
  saveRequest = saveChanges().finally(() => {
    busy.value = false;
    saveRequest = undefined;
  });
}
async function saveChanges() {
  while (pending.size && !disposed) {
    const change = pending.values().next().value!;
    pending.delete(change.field);
    activeChange = change;
    if (change.field !== 'avator') hints[change.field] = '正在保存…';
    try {
      let value: string;
      if (change.field === 'avator') {
        controller = new AbortController();
        const asset = await uploadAsset(change.value, 'avator', { signal: controller.signal });
        if (disposed) return;
        value = asset.url;
      } else {
        value = change.value;
        if (change.field === 'name') value = value.trim();
      }
      const user = await updateProfile({ ...saved.value, [change.field]: value });
      if (disposed) return;
      saved.value = { name: user.name, email: user.email, phone: user.phone, avator: user.avator };
      if (change.field === 'avator') {
        avator.value = null;
      } else if (revisions[change.field] === change.revision) {
        profile.value[change.field] = user[change.field];
        errors[change.field] = '';
        hints[change.field] = '已保存';
      }
    } catch (cause) {
      if (disposed) return;
      if (change.field === 'avator') {
        error.value = errorMessage(cause, '头像保存失败，请重新选择头像重试');
      } else if (revisions[change.field] === change.revision) {
        hints[change.field] = '';
        errors[change.field] = `${errorMessage(cause, '保存失败')}，请再次移开焦点重试`;
      }
    } finally {
      if (change.field === 'avator') savingAvator.value = false;
      controller = undefined;
      activeChange = undefined;
    }
  }
}
async function signOut() {
  if (busy.value || signingOut.value) return;
  if (
    !(await confirm({
      title: '退出登录',
      content: '退出当前账号，返回登录页面。',
      confirmText: '退出登录',
      cancelText: '取消',
    }))
  )
    return;
  signingOut.value = true;
  error.value = '';
  try {
    await logout();
    signingOut.value = false;
    await router.replace({ name: 'login' });
  } catch (cause) {
    error.value = errorMessage(cause, '退出失败，请重试');
  } finally {
    signingOut.value = false;
  }
}
onMounted(() => {
  document.title = '账户资料 · Voex';
  void load();
});
onBeforeUnmount(() => {
  disposed = true;
  pending.clear();
  controller?.abort();
});
</script>

<style scoped lang="stylus">
.profile-page__header
  display flex
  align-items center
  justify-content space-between
  margin-bottom 22px

.profile-page__account:hover
  .profile-page__copy
    opacity 1
    pointer-events auto

.profile-page__account-value
  display flex
  align-items center
  gap 8px

.profile-page__copy
  display inline-flex
  align-items center
  justify-content center
  min-height 24px
  padding 2px 6px
  border-radius 6px
  color var(--color-text-secondary)
  font-size 12px
  opacity 0
  pointer-events none

  &:hover:not(:disabled)
    background var(--auth-input)
    color var(--color-text-primary)

  &:focus-visible
    outline 2px solid var(--auth-focus)
    outline-offset 2px

.profile-page__account-tips
    display: block;
    margin-bottom: 8px;
    color: var(--color-text-secondary);
    font-size: 12px;
    line-height: 18px;

.profile-page__status
  min-height 24px
  color var(--auth-muted)
  font-size 12px

.profile-page__logout
  display flex
  justify-content center
  border-top 1px solid var(--auth-border)
  margin-top 22px
  padding-top 14px
</style>
