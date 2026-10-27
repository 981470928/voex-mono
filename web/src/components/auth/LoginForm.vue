<template>
  <form
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
      :disabled="busy || !!expectedUser"
      :error="errors.account"
      placeholder="输入你的账号"
      @composition="composing = $event"
    />
    <AuthField
      ref="passwordField"
      v-model="password"
      label="密码"
      type="password"
      autocomplete="current-password"
      :disabled="busy"
      :error="errors.password"
      placeholder="输入你的密码"
      @composition="composing = $event"
    />
    <p class="auth-form__error" role="alert">{{ error }}</p>
    <button class="auth-form__submit" type="submit" :disabled="busy">
      <span v-if="busy" class="auth-form__spinner" aria-hidden="true" />{{
        busy ? '正在登录…' : expectedUser ? '重新登录' : '登录'
      }}
    </button>
  </form>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import AuthField from './AuthField.vue';
import { login } from '@/service/api/auth-api';
import type { AuthUser } from '@/service/auth-session';
import { accountError, passwordError } from '@/utils/auth';
import { errorMessage } from '@/utils/error';

const props = defineProps<{ expectedUser?: AuthUser }>();
const emit = defineEmits<{ success: []; busy: [value: boolean] }>();
const account = ref(props.expectedUser?.account ?? '');
const password = ref('');
const busy = ref(false);
const composing = ref(false);
const error = ref('');
const errors = reactive({ account: '', password: '' });
const accountField = ref<InstanceType<typeof AuthField>>();
const passwordField = ref<InstanceType<typeof AuthField>>();
function guardComposition(event: KeyboardEvent) {
  if (event.isComposing || composing.value) event.preventDefault();
}
async function submit() {
  if (busy.value || composing.value) return;
  errors.account = accountError(account.value);
  errors.password = passwordError(password.value);
  if (errors.account) return accountField.value?.focus();
  if (errors.password) return passwordField.value?.focus();
  busy.value = true;
  emit('busy', true);
  error.value = '';
  try {
    await login(account.value, password.value, props.expectedUser?.id);
    password.value = '';
    busy.value = false;
    emit('busy', false);
    emit('success');
  } catch (cause) {
    error.value = errorMessage(cause, '登录失败，请重试');
  } finally {
    busy.value = false;
    emit('busy', false);
  }
}
onMounted(() => (props.expectedUser ? passwordField : accountField).value?.focus());
</script>
