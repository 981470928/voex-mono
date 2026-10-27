<template>
  <VoexModal
    v-if="enabled"
    :id="id"
    :model-value="modelValue"
    :title="title"
    :placement="side"
    :width="width"
    height="100%"
    keep-mounted
    @update:model-value="emit('update:modelValue', $event)"
  >
    <slot />
  </VoexModal>
  <slot v-else />
</template>

<script setup lang="ts">
import VoexModal from '@/plugins/voex-modal/VoexModal.vue';

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    id: string;
    modelValue: boolean;
    title: string;
    side?: 'left' | 'right';
    width?: number | string;
    enabled?: boolean;
  }>(),
  { side: 'left', width: 360, enabled: true }
);

const emit = defineEmits<{
  'update:modelValue': [open: boolean];
}>();
</script>
