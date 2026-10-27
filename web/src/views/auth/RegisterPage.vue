<template>
  <AuthLayout title="创建你的账号" description="一个属于你的文件空间。" wide>
    <form
      v-if="!created"
      class="auth-form"
      novalidate
      :aria-busy="busy"
      @submit.prevent="submit"
      @keydown.enter="guardComposition"
    >
      <AuthField
        ref="accountField"
        v-model="account"
        label="账号"
        autocomplete="username"
        autocapitalize="none"
        :spellcheck="false"
        placeholder="至少 8 个字符"
        :disabled="busy"
        :error="errors.account || availabilityError"
        :hint="availabilityHint"
        :success="availability === 'available'"
        @composition="accountComposition"
      />
      <AuthField
        ref="passwordField"
        v-model="password"
        label="密码"
        type="password"
        autocomplete="new-password"
        placeholder="至少 10 个字符"
        :disabled="busy"
        :error="errors.password"
        :hint="strength.label"
        @composition="composing = $event"
      >
        <div class="register-page__strength" :data-level="strength.level" aria-hidden="true">
          <span
            v-for="index in 3"
            :key="index"
            :class="{ 'register-page__strength-part--active': index <= strength.level }"
          />
        </div>
      </AuthField>
      <ProfileFields
        ref="profileFields"
        v-model="profile"
        :errors="errors"
        :disabled="busy"
        @composition="composing = $event"
      />
      <AvatorPicker v-model="avator" :disabled="busy" />
      <p class="auth-form__error" role="alert">{{ error }}</p>
      <button class="auth-form__submit" type="submit" :disabled="busy">
        <span v-if="busy" class="auth-form__spinner" aria-hidden="true" />{{
          busy ? '正在创建…' : '创建账号'
        }}
      </button>
    </form>
    <div v-else class="auth-form" :aria-busy="busy">
      <p class="register-page__completed" role="status">
        账号已创建{{ busy ? '，正在上传头像…' : '。' }}
      </p>
      <progress
        v-if="busy"
        class="register-page__progress"
        :value="progress"
        max="100"
        aria-label="头像上传进度"
      />
      <p class="auth-form__error" role="alert">{{ error }}</p>
      <button
        v-if="error && avator"
        class="auth-form__submit"
        type="button"
        :disabled="busy"
        @click="finishAvator"
      >
        重试头像上传
      </button>
      <button class="auth-form__submit" type="button" :disabled="busy" @click="enterWorkspace">
        进入工作台
      </button>
      <button
        v-if="uploading"
        class="auth-form__link"
        type="button"
        @click="uploadController?.abort()"
      >
        取消头像上传
      </button>
    </div>
    <div v-if="!created && !busy" class="auth-form__footer">
      <span>已有账号？</span
      ><RouterLink class="auth-form__link" :to="{ name: 'login', query: { return: returnPath } }"
        >登录</RouterLink
      >
    </div>
  </AuthLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, RouterLink, useRoute, useRouter } from 'vue-router';
import AuthLayout from '@/components/auth/AuthLayout.vue';
import AuthField from '@/components/auth/AuthField.vue';
import ProfileFields from '@/components/auth/ProfileFields.vue';
import AvatorPicker from '@/components/auth/AvatorPicker.vue';
import { accountAvailability, register, updateProfile } from '@/service/api/auth-api';
import { uploadAsset } from '@/service/api/upload-api';
import {
  accountError,
  passwordError,
  passwordStrength,
  profileErrors,
  safeReturnPath,
} from '@/utils/auth';
import { errorMessage } from '@/utils/error';
import { useNotificationStore } from '@/stores/notification';

const route = useRoute();
const router = useRouter();
const notification = useNotificationStore();
const returnPath = computed(() => safeReturnPath(route.query.return));
const account = ref('');
const password = ref('');
const profile = ref({ name: '', email: '', phone: '' });
const avator = ref<File | null>(null);
const errors = reactive({ account: '', password: '', name: '', email: '', phone: '' });
const accountField = ref<InstanceType<typeof AuthField>>();
const passwordField = ref<InstanceType<typeof AuthField>>();
const profileFields = ref<InstanceType<typeof ProfileFields>>();
const busy = ref(false);
const created = ref(false);
const composing = ref(false);
const accountComposing = ref(false);
const error = ref('');
const progress = ref(0);
const uploading = ref(false);
const strength = computed(() => passwordStrength(password.value));
const availability = ref<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');
const availabilityError = computed(() =>
  availability.value === 'taken' ? '这个账号已被使用，请换一个' : ''
);
const availabilityHint = computed(
  () =>
    ({
      idle: '8–64 个字符，支持中文、字母、数字和符号',
      checking: '正在检查账号…',
      available: '这个账号可以使用',
      taken: '',
      error: '暂时无法检查，可提交后由服务器确认',
    })[availability.value]
);
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
let uploadController: AbortController | undefined;
let checkVersion = 0;
let uploadedAvator = '';
function scheduleAvailability() {
  clearTimeout(timer);
  controller?.abort();
  const version = ++checkVersion;
  availability.value = 'idle';
  errors.account = '';
  if (accountComposing.value || accountError(account.value)) return;
  const candidate = account.value;
  timer = setTimeout(async () => {
    controller = new AbortController();
    const signal = controller.signal;
    availability.value = 'checking';
    try {
      const result = await accountAvailability(candidate, signal);
      if (!signal.aborted && checkVersion === version)
        availability.value = result.available ? 'available' : 'taken';
    } catch {
      if (!signal.aborted && checkVersion === version) availability.value = 'error';
    }
  }, 300);
}
function accountComposition(value: boolean) {
  composing.value = value;
  accountComposing.value = value;
  scheduleAvailability();
}
function guardComposition(event: KeyboardEvent) {
  if (event.isComposing || composing.value) event.preventDefault();
}
async function submit() {
  if (busy.value || composing.value || created.value) return;
  Object.assign(errors, profileErrors(profile.value), {
    account: accountError(account.value) || availabilityError.value,
    password: passwordError(password.value),
  });
  await nextTick();
  if (errors.account) return accountField.value?.focus();
  if (errors.password) return passwordField.value?.focus();
  if (errors.name || errors.email || errors.phone) return profileFields.value?.focusError();
  clearTimeout(timer);
  controller?.abort();
  busy.value = true;
  error.value = '';
  try {
    await register({
      ...profile.value,
      name: profile.value.name.trim(),
      account: account.value,
      password: password.value,
    });
    created.value = true;
    password.value = '';
  } catch (cause) {
    error.value = errorMessage(cause, '创建失败，请重试');
    return;
  } finally {
    busy.value = false;
  }
  if (avator.value) await finishAvator();
  else await enterWorkspace();
}
async function finishAvator() {
  if (busy.value || !avator.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (!uploadedAvator) {
      uploading.value = true;
      uploadController = new AbortController();
      const asset = await uploadAsset(avator.value, 'avator', {
        signal: uploadController.signal,
        onProgress: (value) => {
          progress.value = value;
        },
      });
      uploadedAvator = asset.url;
      uploading.value = false;
    }
    await updateProfile({
      ...profile.value,
      name: profile.value.name.trim(),
      avator: uploadedAvator,
    });
  } catch (cause) {
    error.value = uploadController?.signal.aborted
      ? '账号已创建，头像上传已取消。可重新上传，或进入工作台后设置。'
      : `账号已创建，头像尚未保存：${errorMessage(cause)}。也可进入工作台后在账户资料中设置。`;
    return;
  } finally {
    busy.value = false;
    uploading.value = false;
    uploadController = undefined;
  }
  await enterWorkspace();
}
async function enterWorkspace() {
  notification.show('账号已创建', 'success');
  await router.replace(returnPath.value);
}
watch(account, scheduleAvailability);
onBeforeRouteLeave(() => !busy.value);
onMounted(() => {
  document.title = '创建账号 · Voex';
  accountField.value?.focus();
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  controller?.abort();
  uploadController?.abort();
  checkVersion++;
});
</script>

<style scoped lang="stylus">
.register-page__strength
  display flex
  gap 5px
  margin 3px 0 12px

  span
    width 33.33%
    height 3px
    border-radius 2px
    background var(--auth-border)

  &[data-level='1'] .register-page__strength-part--active
    background var(--auth-error)

  &[data-level='2'] .register-page__strength-part--active
    background var(--auth-focus)

  &[data-level='3'] .register-page__strength-part--active
    background var(--auth-success)

.register-page__completed
  text-align center
  color var(--color-text-secondary)
  font-size 14px
  line-height 1.7

.register-page__progress
  width 100%
  height 5px
  accent-color var(--auth-focus)
</style>
