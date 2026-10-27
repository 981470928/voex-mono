<template>
  <button
    class="avator-picker"
    type="button"
    aria-label="选择头像"
    :aria-busy="loading"
    :disabled="disabled || loading"
    @click="choose"
  >
    <img
      v-if="preview || current"
      :src="preview || current"
      alt="头像预览"
      width="48"
      height="48"
    />
    <SvgIcon v-else name="users" :size="22" />
    <span v-if="loading" class="avator-picker__loading" role="status" aria-label="正在加载头像">
      <span class="auth-form__spinner" aria-hidden="true" />
    </span>
  </button>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { avatorFileError } from '@/utils/auth';
import { FILE_ACCEPT, originalGetImportFiles } from '@/utils/dom';
import { errorMessage } from '@/utils/error';
const props = defineProps<{
  modelValue: File | null;
  current?: string;
  disabled?: boolean;
  loading?: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: File];
  error: [value: string];
}>();

const choosing = ref(false);
let disposed = false;
const preview = ref('');
watch(
  () => props.modelValue,
  (file) => {
    if (preview.value) URL.revokeObjectURL(preview.value);
    preview.value = file ? URL.createObjectURL(file) : '';
  },
  { immediate: true }
);
async function choose() {
  if (props.disabled || props.loading || choosing.value) return;
  choosing.value = true;
  try {
    const [file] = await originalGetImportFiles(FILE_ACCEPT.AVATAR, false);
    if (!file || disposed || props.disabled || props.loading) return;
    const error = avatorFileError(file);
    if (error) {
      emit('error', error);
    } else {
      emit('update:modelValue', file);
    }
  } catch (cause) {
    if (!disposed) emit('error', errorMessage(cause, '无法选择头像，请重试'));
  } finally {
    choosing.value = false;
  }
}

onBeforeUnmount(() => {
  disposed = true;
  if (preview.value) URL.revokeObjectURL(preview.value);
});
</script>

<style scoped lang="stylus">
.avator-picker
  position relative
  display flex
  align-items center
  justify-content center
  width 48px
  height 48px
  border-radius 50%
  overflow hidden
  color var(--auth-muted)

  &:disabled
    cursor pointer

  img
    width 100%
    height 100%
    object-fit cover

.avator-picker__loading
  position absolute
  inset 0
  display flex
  align-items center
  justify-content center
  background var(--auth-input)
</style>
