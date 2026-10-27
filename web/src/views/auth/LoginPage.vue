<template>
  <AuthLayout title="登录 Voex" description="继续整理你的文件与想法。">
    <LoginForm @success="onSuccess" @busy="busy = $event" />
    <div v-if="!busy" class="auth-form__footer">
      <span>还没有账号？</span
      ><RouterLink class="auth-form__link" :to="{ name: 'register', query: { return: returnPath } }"
        >创建账号</RouterLink
      >
    </div>
  </AuthLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { onBeforeRouteLeave, RouterLink, useRoute, useRouter } from 'vue-router';
import AuthLayout from '@/components/auth/AuthLayout.vue';
import LoginForm from '@/components/auth/LoginForm.vue';
import { safeReturnPath } from '@/utils/auth';
const route = useRoute();
const router = useRouter();
const busy = ref(false);
const returnPath = computed(() => safeReturnPath(route.query.return));
async function onSuccess() {
  await router.replace(returnPath.value);
}
onMounted(() => {
  document.title = '登录 · Voex';
});
onBeforeRouteLeave(() => !busy.value);
</script>
