<template>
  <AuthField
    ref="nameField"
    :model-value="modelValue.name"
    label="昵称"
    autocomplete="nickname"
    placeholder="怎么称呼你"
    :disabled="disabled"
    :error="errors.name"
    :hint="hints?.name"
    :success="hints?.name === '已保存'"
    @update:model-value="update('name', $event)"
    @blur="$emit('blur', 'name')"
    @composition="$emit('composition', $event)"
  />
  <AuthField
    ref="emailField"
    :model-value="modelValue.email"
    label="邮箱"
    type="email"
    autocomplete="email"
    placeholder="你的邮箱地址"
    optional
    :disabled="disabled"
    :error="errors.email"
    :hint="hints?.email"
    :success="hints?.email === '已保存'"
    @update:model-value="update('email', $event)"
    @blur="$emit('blur', 'email')"
    @composition="$emit('composition', $event)"
  />
  <AuthField
    ref="phoneField"
    :model-value="modelValue.phone"
    label="手机号"
    type="tel"
    autocomplete="tel"
    placeholder="你的手机号码"
    optional
    :disabled="disabled"
    :error="errors.phone"
    :hint="hints?.phone"
    :success="hints?.phone === '已保存'"
    @update:model-value="update('phone', $event)"
    @blur="$emit('blur', 'phone')"
    @composition="$emit('composition', $event)"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import AuthField from './AuthField.vue';
type Fields = { name: string; email: string; phone: string };
const props = defineProps<{
  modelValue: Fields;
  errors: Fields;
  hints?: Fields;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: Fields];
  composition: [value: boolean];
  blur: [field: keyof Fields];
}>();
const nameField = ref<InstanceType<typeof AuthField>>();
const emailField = ref<InstanceType<typeof AuthField>>();
const phoneField = ref<InstanceType<typeof AuthField>>();
function update(key: keyof Fields, value: string) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}
defineExpose({
  focusError: () => {
    if (props.errors.name) nameField.value?.focus();
    else if (props.errors.email) emailField.value?.focus();
    else if (props.errors.phone) phoneField.value?.focus();
  },
});
</script>
