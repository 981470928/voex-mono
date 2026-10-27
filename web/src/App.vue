<!-- App.vue -->
<template>
  <div class="the-app">
    <router-view />
    <component
      :is="item.component"
      v-for="item in modalStore.renderedModals"
      :key="item.key"
      v-bind="item.props"
    />
    <NotificationBar />
    <SessionRecovery />
  </div>
</template>

<script setup lang="ts">
import { useThemeStore } from '@/stores/theme';
import { useModalStore } from '@/stores/modal';
import NotificationBar from '@/components/NotificationBar.vue';
import SessionRecovery from '@/components/auth/SessionRecovery.vue';
const modalStore = useModalStore();
// 初始化主题（读取 localStorage / 系统偏好，设置 data-theme）
useThemeStore();
</script>
<style lang="stylus">
#app,
.the-app
  width 100%
  height 100%
</style>
