<template>
  <VoexTrigger
    v-model:popup-visible="webMenuOpen"
    trigger="click"
    position="top-end"
    strategy="fixed"
    :popup-offset="8"
    :disabled="disabled"
    content-class="ai-panel__web-popup"
    role="dialog"
    aria-label="选择搜索引擎"
    @show="focusSelectedWebEngine"
  >
    <button
      ref="webTrigger"
      class="ai-panel__control ai-panel__icon-button"
      type="button"
      :aria-label="webSearchLabel"
      :title="webSearchLabel"
      aria-haspopup="dialog"
      :disabled="disabled"
      @keydown.down.prevent="webMenuOpen = true"
      @keydown.up.prevent="webMenuOpen = true"
    >
      <SvgIcon
        name="world"
        :size="18"
        :color="webSearchEnabled ? 'var(--color-brand-bg)' : undefined"
      />
    </button>
    <template #content>
      <div ref="webMenu" class="ai-panel__web-menu" tabindex="-1" @keydown.tab="onWebMenuTab">
        <div class="ai-panel__web-heading">
          <span>搜索引擎</span>
          <VoexTooltip
            content="选择引擎后可搜索并读取公开网页；搜索词会发送给该引擎，网页内容会提供给当前模型。选择“无”关闭联网。Bing RSS 无需 Key，可用性可能波动。"
          >
            <button
              type="button"
              class="ai-panel__control ai-panel__web-help"
              aria-label="联网搜索与网页读取说明"
            >
              <SvgIcon name="question-mark" :size="16" />
            </button>
          </VoexTooltip>
        </div>
        <fieldset
          class="ai-panel__web-options"
          :aria-describedby="webEngineError ? webStatusId : undefined"
        >
          <legend class="ai-panel__sr-only">可用搜索引擎</legend>
          <label
            v-for="engine in webEngineOptions"
            :key="engine.id"
            class="ai-panel__web-option"
            :class="{
              'ai-panel__web-option--selected': selectedWebEngineId === engine.id,
            }"
          >
            <input
              v-model="selectedWebEngineId"
              type="radio"
              :name="webGroupName"
              :value="engine.id"
              :disabled="disabled || (!!engine.id && webEnginesLoading)"
              @change="emit('change')"
              @click="selectWebEngine(engine.id)"
              @keydown.enter.prevent="selectWebEngine(engine.id)"
            />
            <span>{{ engine.name }}</span>
            <small v-if="!engine.id">不开启搜索</small>
          </label>
        </fieldset>
        <template v-if="webEngineError">
          <p :id="webStatusId" class="ai-panel__web-status ai-error" role="alert">
            {{ webEngineError }}
          </p>
          <button
            class="ai-button ai-panel__web-retry"
            type="button"
            :disabled="disabled || webEnginesLoading"
            @click="emit('reload')"
          >
            重新加载引擎
          </button>
        </template>
      </div>
    </template>
  </VoexTrigger>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { VoexTrigger } from '@/plugins/trigger';
import { VoexTooltip } from '@/plugins/tooltip';
import type { AIWebEngine } from '@/agent/types';

const props = defineProps<{
  webEngines: AIWebEngine[];
  webEnginesLoading: boolean;
  webEngineError: string;
  disabled: boolean;
}>();
const emit = defineEmits<{
  reload: [];
  change: [];
  tabNext: [];
}>();
const selectedWebEngineId = defineModel<string>({ required: true });
const webMenuOpen = defineModel<boolean>('open', { required: true });
const webSearchEnabled = computed(() => selectedWebEngineId.value !== '');
const webEngineOptions = computed(() => [{ id: '', name: '无' }, ...props.webEngines]);
const selectedWebEngine = computed(() =>
  props.webEngines.find((engine) => engine.id === selectedWebEngineId.value)
);
const webSearchLabel = computed(() =>
  webSearchEnabled.value ? `联网搜索：${selectedWebEngine.value?.name || '已开启'}` : '联网搜索：无'
);
const webTrigger = ref<HTMLButtonElement>();
const webMenu = ref<HTMLElement>();
const webGroupName = useId() + '-web-engine';
const webStatusId = useId() + '-web-status';

function focusTrigger() {
  webTrigger.value?.focus({ preventScroll: true });
}
defineExpose({ focusTrigger });

function focusSelectedWebEngine() {
  if (!webMenuOpen.value) return;
  const selected = webMenu.value?.querySelector<HTMLInputElement>('input:checked:not(:disabled)');
  (selected ?? webMenu.value)?.focus({ preventScroll: true });
}
function selectWebEngine(id: string) {
  if (props.disabled) return;
  if (id && (props.webEnginesLoading || !props.webEngines.some((engine) => engine.id === id)))
    return;
  selectedWebEngineId.value = id;
  emit('change');
  webMenuOpen.value = false;
  webTrigger.value?.focus({ preventScroll: true });
}
function onWebMenuTab(event: KeyboardEvent) {
  const controls = webMenu.value?.querySelectorAll<HTMLElement>(
    'button:enabled, input:checked:not(:disabled)'
  );
  if (!controls?.length) return;
  if (event.shiftKey && event.target === controls[0]) {
    event.preventDefault();
    webMenuOpen.value = false;
    webTrigger.value?.focus({ preventScroll: true });
  } else if (!event.shiftKey && event.target === controls[controls.length - 1]) {
    event.preventDefault();
    webMenuOpen.value = false;
    emit('tabNext');
  }
}
</script>

<style scoped lang="stylus">
:global(.ai-panel__web-popup)
  width unquote('min(240px, calc(100vw - 24px))')
  border 1px solid var(--color-border-secondary)

.ai-panel
  &__web-menu
    box-sizing border-box
    max-height unquote('min(320px, var(--voex-trigger-available-height, 320px))')
    padding 8px
    overflow-y auto
    overscroll-behavior contain
  &__web-heading
    display flex
    align-items center
    gap 4px
    padding 0 4px 4px
    color var(--color-text-primary)
    font-size 12px
    font-weight 500
  &__web-help
    width 28px
    min-height 28px
    padding 4px
  &__web-options
    margin 0
    padding 0
    border 0
    min-width 0
  &__web-option
    display flex
    align-items center
    gap 8px
    min-height 36px
    padding 8px
    border-radius var(--border-radius-item-s, 6px)
    color var(--color-text-primary)
    font-size 12px
    cursor pointer
    &:hover:not(:has(input:disabled))
      background var(--color-bg-tertiary)

    &:active:not(:has(input:disabled))
      background var(--color-selection-dim)
    &--selected
      background var(--color-selection-dim)
    &:has(input:disabled)
      opacity .5
      cursor not-allowed
    input
      flex-shrink 0
      margin 0
      width 14px
      height 14px
      accent-color var(--color-accent)
      cursor inherit
    span
      overflow-wrap anywhere
    small
      color var(--color-text-tertiary)
      font-size 11px
  &__web-retry
    margin-top 4px
  &__web-status
    min-height 18px
    margin 6px 0 0
    color var(--color-text-tertiary)
    font-size 11px
    line-height 1.6
    overflow-wrap anywhere
    &.ai-error
      color var(--color-red)
</style>
