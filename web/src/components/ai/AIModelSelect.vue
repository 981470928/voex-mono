<template>
  <VoexTrigger
    v-model:popup-visible="modelMenuOpen"
    trigger="click"
    position="top-start"
    strategy="fixed"
    :popup-offset="8"
    :disabled="disabled || loading"
    auto-fit-popup-width
    content-class="ai-panel__model-popup"
    role="dialog"
    aria-label="选择 AI 模型"
    @show="focusSelectedModel"
  >
    <button
      ref="modelTrigger"
      class="ai-panel__control ai-panel__model-trigger"
      type="button"
      :title="selectedModel ? selectedModel.name + ' · ' + selectedModel.model : '选择模型'"
      :aria-label="selectedModel ? '当前模型：' + selectedModel.name : '选择模型'"
      aria-haspopup="dialog"
      :disabled="disabled || loading"
      @keydown.down.prevent="modelMenuOpen = true"
      @keydown.up.prevent="modelMenuOpen = true"
    >
      <span>{{ selectedModel?.name || '选择模型' }}</span>
      <small v-if="selectedModel?.multimodal_enabled" class="ai-panel__multimodal">多模态</small>
      <SvgIcon
        name="chevron-right"
        :size="14"
        class="ai-panel__model-chevron"
        :class="{ 'ai-panel__model-chevron--open': modelMenuOpen }"
      />
    </button>
    <template #content>
      <div ref="modelMenu" class="ai-panel__model-menu" @keydown.tab="onModelMenuTab">
        <fieldset v-if="models.length" class="ai-panel__model-options">
          <legend class="ai-panel__sr-only">可用模型</legend>
          <div v-for="model in models" :key="model.id" class="ai-panel__model-row">
            <label
              class="ai-panel__model-option"
              :class="{ 'ai-panel__model-option--selected': selectedId === model.id }"
            >
              <input
                v-model="selectedId"
                type="radio"
                :name="modelGroupName"
                :value="model.id"
                @click="selectModel(model.id)"
                @keydown.enter.prevent="selectModel(model.id)"
              />
              <span>
                <strong class="ai-panel__model-name"
                  >{{ model.name
                  }}<span v-if="model.multimodal_enabled" class="ai-panel__multimodal"
                    >多模态</span
                  ></strong
                >
                <small>{{ model.model }}</small>
              </span>
            </label>
            <button
              type="button"
              class="ai-panel__control ai-panel__model-edit"
              :aria-label="'编辑模型：' + model.name"
              :title="'编辑模型：' + model.name"
              @click="emit('edit', model)"
            >
              <SvgIcon name="write" :size="16" />
            </button>
            <button
              type="button"
              class="ai-panel__control ai-panel__model-delete"
              :aria-label="'删除模型：' + model.name"
              :title="'删除模型：' + model.name"
              :disabled="disabled || loading"
              @click="emit('delete', model)"
            >
              <SvgIcon name="trash" :size="16" />
            </button>
          </div>
        </fieldset>
        <p v-else class="ai-panel__model-empty">暂无模型，请先配置</p>
        <button
          ref="modelSettingsButton"
          class="ai-panel__control ai-panel__model-settings"
          type="button"
          @click="emit('edit', null)"
        >
          <SvgIcon name="add" :size="16" />
          新增模型
        </button>
      </div>
    </template>
  </VoexTrigger>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { VoexTrigger } from '@/plugins/trigger';
import type { AIModel } from '@/agent/types';

const props = defineProps<{
  models: AIModel[];
  disabled: boolean;
  loading: boolean;
}>();
const emit = defineEmits<{
  edit: [model: AIModel | null];
  delete: [model: AIModel];
  tabNext: [];
}>();
const selectedId = defineModel<string>({ required: true });
const modelMenuOpen = defineModel<boolean>('open', { required: true });
const selectedModel = computed(() => props.models.find((model) => model.id === selectedId.value));
const modelGroupName = useId() + '-ai-model';
const modelTrigger = ref<HTMLButtonElement>();
const modelMenu = ref<HTMLElement>();
const modelSettingsButton = ref<HTMLButtonElement>();

function focusTrigger() {
  modelTrigger.value?.focus({ preventScroll: true });
}
defineExpose({ focusTrigger });

function focusSelectedModel() {
  if (!modelMenuOpen.value) return;
  const selected = modelMenu.value?.querySelector<HTMLInputElement>('input:checked');
  (selected ?? modelSettingsButton.value)?.focus({ preventScroll: true });
}
function selectModel(id: string) {
  if (props.disabled) return;
  selectedId.value = id;
  modelMenuOpen.value = false;
  modelTrigger.value?.focus({ preventScroll: true });
}
function onModelMenuTab(event: KeyboardEvent) {
  const firstControl = modelMenu.value?.querySelector('input:checked, button:enabled');
  const atStart = event.target === firstControl;
  if (event.shiftKey && atStart) {
    event.preventDefault();
    modelMenuOpen.value = false;
    modelTrigger.value?.focus({ preventScroll: true });
  } else if (!event.shiftKey && event.target === modelSettingsButton.value) {
    event.preventDefault();
    modelMenuOpen.value = false;
    emit('tabNext');
  }
}
</script>

<style scoped lang="stylus">
:global(.ai-panel__model-popup)
  border 1px solid var(--color-border-secondary)
  min-width unquote('min(280px, calc(100vw - 24px))')

.ai-panel
  &__multimodal
    display inline-block
    flex-shrink 0
    padding 1px 4px
    border 1px solid var(--color-border-secondary)
    border-radius 4px
    color var(--color-accent)
    font-size 10px
    font-weight 400
    line-height 1.4
    white-space nowrap
  &__model-option strong.ai-panel__model-name
    display flex
    align-items center
    gap 6px
  &__model-trigger
    justify-content space-between
    gap 6px
    padding-inline 8px
    span
      flex 1
      min-width 0
      text-align left
      overflow hidden
      text-overflow ellipsis
      white-space nowrap
  &__model-chevron
    flex-shrink 0
    transform rotate(-90deg)
    &--open
      transform rotate(90deg)
  &__model-menu
    display flex
    flex-direction column
    max-height unquote('min(320px, var(--voex-trigger-available-height, 320px))')
    padding 4px
    overflow-y auto
    overscroll-behavior contain
  &__model-options
    flex-shrink 0
    min-width 0
    min-height 0
    margin 0
    padding 0
    border 0
  &__model-row
    display flex
    align-items center
    gap 4px
  &__model-edit, &__model-delete
    flex-shrink 0
    width 32px
    height 32px
    padding 6px
  &__model-option
    flex 1
    min-width 0
    display flex
    align-items center
    gap 8px
    padding 9px 8px
    border-radius var(--border-radius-item-s, 6px)
    cursor pointer
    &:hover
      background var(--color-bg-tertiary)

    &:active
      background var(--color-bg-tertiary)
    &--selected
      background var(--color-selection-dim)
    input
      flex-shrink 0
      width 14px
      height 14px
      margin 0
      accent-color var(--color-accent)
      cursor pointer
    span
      min-width 0
      overflow-wrap anywhere
    strong, small
      display block
    strong
      color var(--color-text-primary)
      font-size 12px
      font-weight 500
    small
      margin-top 3px
      color var(--color-text-tertiary)
      font-size 11px
  &__model-empty
    margin 0
    padding 12px 8px
    color var(--color-text-tertiary)
    font-size 12px
  &__model-settings
    flex-shrink 0
    justify-content flex-start
    gap 8px
    width 100%
    margin-top 4px
    padding 10px 8px
    border-top 1px solid var(--color-border-secondary)
</style>
