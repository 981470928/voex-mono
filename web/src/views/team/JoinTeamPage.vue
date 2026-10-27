<template>
  <main class="join-page team-ui">
    <section class="join-page__content">
      <h1>加入团队</h1>
      <p>
        {{
          applied
            ? '申请已提交，审核结果可在团队页面查看。'
            : '填写申请信息，由团队所有者或管理员审核。'
        }}
      </p>
      <div class="team-ui__actions">
        <button
          v-if="!applied"
          class="team-ui__button team-ui__button--primary"
          type="button"
          @click="open = true"
        >
          填写申请
        </button>
        <RouterLink class="team-ui__button" :to="{ name: 'teams' }">前往团队</RouterLink>
      </div>
    </section>
  </main>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useDialog } from '@/composables/useDialog';
import { ModalType } from '@/stores/modal';
const route = useRoute();
const token = computed(() => route.hash.slice(1));
const open = ref(true);
const applied = ref(false);
useDialog(ModalType.JOIN_TEAM_DIALOG, {
  visible: () => open.value,
  props: () => ({
    inviteToken: token.value,
    onApplied: () => {
      applied.value = true;
    },
  }),
  onClose: () => {
    open.value = false;
  },
});
</script>
<style scoped lang="stylus">
@import '../../components/team/team.styl'
.join-page
  display grid
  place-items center
  min-height 100%
  padding 32px 16px
  background var(--color-bg-primary)
.join-page__content
  width min(100%, 460px)
  h1
    color var(--color-text-primary)
    font-size 24px
    margin 0 0 12px
  p
    margin 0 0 24px
</style>
