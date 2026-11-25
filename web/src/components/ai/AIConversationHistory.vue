<template>
  <VoexTrigger
    v-model:popup-visible="conversationMenuOpen"
    trigger="click"
    position="bottom-end"
    strategy="fixed"
    :popup-offset="8"
    content-class="ai-panel__history-popup"
    role="dialog"
    aria-label="历史对话"
    @show="focusSelectedConversation"
  >
    <button
      ref="conversationTrigger"
      class="ai-panel__header-button"
      type="button"
      title="历史对话"
      aria-label="历史对话"
      aria-haspopup="dialog"
      @keydown.down.prevent="conversationMenuOpen = true"
      @keydown.up.prevent="conversationMenuOpen = true"
    >
      <SvgIcon name="conversation" :size="18" />
    </button>
    <template #content>
      <div
        ref="conversationMenu"
        class="ai-panel__history-menu"
        tabindex="-1"
        @keydown.tab="onConversationMenuTab"
      >
        <p
          v-if="!conversationList.loading && !conversations.length && !conversationList.error"
          class="ai-panel__history-status"
        >
          尚无对话
        </p>
        <ul v-if="conversations.length" class="ai-panel__history-list">
          <li v-for="session in conversations" :key="session.id" class="ai-panel__history-row">
            <button
              class="ai-panel__history-item"
              type="button"
              :title="conversationLabel(session)"
              :aria-current="conversationId === session.id ? 'true' : undefined"
              :disabled="conversationLocked"
              @click="emit('select', session.id)"
            >
              <strong>{{ session.title }}</strong>
              <small>{{ conversationDate(session) }}</small>
            </button>
            <button
              class="ai-panel__history-delete"
              type="button"
              :title="
                hasPendingResponse(session.id) ? '请先保存此对话中尚未保存的回复' : '删除对话'
              "
              :aria-label="'删除对话：' + session.title"
              :disabled="conversationLocked || hasPendingResponse(session.id)"
              @click="emit('delete', session)"
            >
              <SvgIcon name="trash" :size="16" />
            </button>
          </li>
        </ul>
        <button
          v-if="conversationList.error"
          class="ai-button ai-panel__history-more"
          type="button"
          :disabled="conversationList.loading"
          @click="emit('load')"
        >
          重新加载对话
        </button>
        <button
          v-if="conversationList.nextCursor"
          class="ai-button ai-panel__history-more"
          type="button"
          :disabled="conversationLocked"
          @click="emit('load', true)"
        >
          加载更多对话
        </button>
      </div>
    </template>
  </VoexTrigger>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { VoexTrigger } from '@/plugins/trigger';
import type { AIConversationSession } from '@/agent/types';

defineProps<{
  conversationList: { loading: boolean; error: string; nextCursor: string };
  conversations: AIConversationSession[];
  conversationId: string;
  conversationLocked: boolean;
  hasPendingResponse: (id: string) => boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  delete: [session: AIConversationSession];
  load: [older?: boolean];
  tabNext: [];
}>();
const conversationMenuOpen = defineModel<boolean>('open', { required: true });
const conversationTrigger = ref<HTMLButtonElement>();
const conversationMenu = ref<HTMLElement>();

function focusTrigger() {
  conversationTrigger.value?.focus({ preventScroll: true });
}
defineExpose({ focusTrigger });

function conversationDate(session: AIConversationSession) {
  return new Date(session.createdAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
function conversationLabel(session: AIConversationSession) {
  return `${session.title} · ${conversationDate(session)}`;
}
function focusSelectedConversation() {
  if (!conversationMenuOpen.value) return;
  const menu = conversationMenu.value;
  const selected = menu?.querySelector<HTMLButtonElement>('button[aria-current="true"]:enabled');
  (selected ?? menu?.querySelector<HTMLButtonElement>('button:enabled') ?? menu)?.focus({
    preventScroll: true,
  });
}
function onConversationMenuTab(event: KeyboardEvent) {
  const buttons = conversationMenu.value?.querySelectorAll<HTMLButtonElement>('button:enabled');
  if (!buttons?.length || (event.shiftKey && event.target === buttons[0])) {
    event.preventDefault();
    conversationMenuOpen.value = false;
    conversationTrigger.value?.focus({ preventScroll: true });
  } else if (!event.shiftKey && event.target === buttons[buttons.length - 1]) {
    event.preventDefault();
    conversationMenuOpen.value = false;
    emit('tabNext');
  }
}
</script>

<style scoped lang="stylus">
:global(.ai-panel__history-popup)
  border 1px solid var(--color-border-secondary)
  max-height unquote('min(280px, var(--voex-trigger-available-height, 280px))')

.ai-panel
  &__history-menu
    box-sizing border-box
    width 280px
    max-width unquote('min(calc(100vw - 18px), var(--voex-trigger-available-width, 280px))')
    padding 4px
  &__history-list
    margin 0
    padding 0
    list-style none
  &__history-row
    display flex
    align-items center
    gap 4px
  &__history-delete
    display inline-flex
    align-items center
    justify-content center
    flex-shrink 0
    width 28px
    height 28px
    padding 0
    border 0
    border-radius var(--border-radius-item-s, 6px)
    background transparent
    color var(--color-text-tertiary)
    cursor pointer
    &:hover:not(:disabled)
      background var(--color-bg-tertiary)
      color var(--color-red)
    &:active:not(:disabled)
      background var(--color-selection-dim)
    &:disabled
      opacity .4
      cursor not-allowed
  &__history-item
    display block
    flex 1
    min-width 0
    padding 9px 8px
    border 0
    border-radius var(--border-radius-item-s, 6px)
    background transparent
    color var(--color-text-primary)
    font inherit
    text-align left
    cursor pointer
    &:hover:not(:disabled)
      background var(--color-bg-tertiary)
    &:active:not(:disabled)
      background var(--color-selection-bg)
    &[aria-current='true']
      background var(--color-selection-dim)
    &:disabled
      opacity .5
      cursor not-allowed
    strong, small
      display block
    strong
      overflow hidden
      text-overflow ellipsis
      white-space nowrap
      font-size 13px
      font-weight 500
    small
      margin-top 3px
      color var(--color-text-tertiary)
      font-size 11px
  &__history-status
    margin 0
    padding 12px 8px
    color var(--color-text-secondary)
    font-size 12px
  &__history-more
    width 100%
    margin-top 4px
</style>
