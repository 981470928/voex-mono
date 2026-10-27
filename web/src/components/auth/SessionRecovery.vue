<template>
  <VoexModal
    :model-value="!route.meta.public && sessionExpired && !!authUser"
    title="重新登录"
    :closable="false"
    :mask-closable="false"
    :close-disabled="true"
    :width="390"
  >
    <div v-if="authUser" class="auth-recovery" data-theme="dark">
      <p class="auth-recovery__description">
        登录已过期，当前编辑内容已保留。使用原账号登录后继续。
      </p>
      <LoginForm :key="authUser.id" :expected-user="authUser" />
    </div>
  </VoexModal>
</template>

<script setup lang="ts">
import VoexModal from '@/plugins/voex-modal/VoexModal.vue';
import LoginForm from './LoginForm.vue';
import { authUser, sessionExpired } from '@/service/auth-session';
import { useRoute } from 'vue-router';
import '@/assets/style/auth.styl';

const route = useRoute();
</script>

<style scoped lang="stylus">
.auth-recovery__description
  margin-bottom 20px
  color var(--auth-muted)
  font-size 13px
  line-height 1.7
</style>
