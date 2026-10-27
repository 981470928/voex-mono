<template>
  <div class="auth-field">
    <label :for="id" class="auth-field__label"
      >{{ label }}<span v-if="optional">（选填）</span></label
    >
    <div class="auth-field__control" :class="{ 'auth-field__control--invalid': error }">
      <input
        :id="id"
        ref="input"
        v-bind="$attrs"
        class="auth-field__input"
        :value="modelValue"
        :type="type === 'password' && visible ? 'text' : type"
        :disabled="disabled"
        :aria-invalid="!!error"
        :aria-describedby="`${id}-hint`"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @compositionstart="$emit('composition', true)"
        @compositionend="$emit('composition', false)"
      />
      <button
        v-if="type === 'password'"
        class="auth-field__reveal"
        type="button"
        :aria-label="visible ? '隐藏密码' : '显示密码'"
        :aria-pressed="visible"
        :disabled="disabled"
        @click="visible = !visible"
      >
        {{ visible ? '隐藏' : '显示' }}
      </button>
    </div>
    <p
      :id="`${id}-hint`"
      class="auth-field__hint"
      :class="{ 'auth-field__hint--error': error, 'auth-field__hint--success': success && !error }"
      aria-live="polite"
    >
      {{ error || hint || '\u00a0' }}
    </p>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, useId } from 'vue';
defineOptions({ inheritAttrs: false });
withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    type?: string;
    error?: string;
    hint?: string;
    disabled?: boolean;
    optional?: boolean;
    success?: boolean;
  }>(),
  { type: 'text', error: '', hint: '' }
);
defineEmits<{ 'update:modelValue': [value: string]; composition: [value: boolean] }>();
const id = useId();
const input = ref<HTMLInputElement>();
const visible = ref(false);
defineExpose({ focus: () => input.value?.focus() });
</script>

<style scoped lang="stylus">
.auth-field__label
  display block
  margin-bottom 8px
  color var(--color-text-secondary)
  font-size 12px
  line-height 18px

  span
    color var(--auth-muted)

.auth-field__control
  display flex
  align-items center
  min-height 44px
  border 1px solid var(--auth-border)
  border-radius 10px
  background var(--auth-input)
  transition border-color .15s

  &:focus-within
    border-color var(--auth-focus)
    box-shadow 0 0 0 1px var(--auth-focus)

  &--invalid
    border-color var(--auth-error)

.auth-field__input
  min-width 0
  width 100%
  height 42px
  padding 10px 12px
  color var(--color-text-primary)
  font-size 14px
  line-height 20px
  border-radius inherit
  outline none

  &::placeholder
    color var(--auth-muted)

  &:disabled
    opacity .65

  &:-webkit-autofill
    -webkit-text-fill-color var(--color-text-primary)
    box-shadow 0 0 0 100px var(--auth-input) inset

.auth-field__reveal
  flex-shrink 0
  align-self stretch
  padding 0 12px
  border-radius 8px
  color var(--auth-muted)
  font-size 12px

  &:hover:not(:disabled)
    color var(--color-text-primary)

.auth-field__hint
  min-height 22px
  padding-top 5px
  color var(--auth-muted)
  font-size 11px
  line-height 17px
  overflow-wrap anywhere

  &--error
    color var(--auth-error)

  &--success
    color var(--auth-success)
</style>
