<template>
  <VoexModal
    :model-value="true"
    title="导入文件"
    :width="520"
    :busy="busy || opening"
    :mask-closable="false"
    @close="close"
  >
    <div class="document-transfer">
      <p class="document-transfer__destination">导入到：{{ targetName }}</p>
      <template v-if="!result">
        <div class="document-transfer__field">
          <label :for="inputId">选择文件</label>
          <input
            :id="inputId"
            ref="fileInput"
            class="document-transfer__input"
            type="file"
            accept=".voex,.md"
            :disabled="busy || !allowed"
            :aria-describedby="`${inputId}-hint ${inputId}-error`"
            :aria-invalid="error ? 'true' : undefined"
            @change="selectFile"
          />
          <span :id="`${inputId}-hint`" class="document-transfer__hint"
            >支持 .voex（最多 512 MiB）或单个 .md（最多 2 MiB），导入后创建新文档。</span
          >
        </div>
        <p v-if="file" class="document-transfer__name">
          {{ file.name }} · {{ formatSize(file.size) }}
        </p>
        <p class="document-transfer__hint">
          Markdown 不会带入本地引用文件；外链图片保留原地址。Voex
          缺失附件时保留正文和可用附件，并列出缺失项。
        </p>
      </template>
      <p v-else class="document-transfer__name">已导入：{{ result.document.file_name }}</p>
      <p class="document-transfer__status" role="status" aria-live="polite">{{ status }}</p>
      <progress
        v-if="busy"
        class="document-transfer__progress"
        :value="progress ?? undefined"
        max="100"
        :aria-label="status"
      />
      <p v-if="!allowed && !result" class="document-transfer__error" role="alert">
        需要登录并拥有当前文件夹的写权限才能导入。
      </p>
      <p :id="`${inputId}-error`" class="document-transfer__error" role="alert">{{ error }}</p>
      <TransferWarnings v-if="result" :warnings="result.warnings" />
    </div>
    <template #footer>
      <div class="document-transfer document-transfer__actions">
        <button v-if="busy" type="button" class="document-transfer__button" @click="cancel">
          取消等待
        </button>
        <template v-else>
          <button
            type="button"
            class="document-transfer__button"
            :disabled="opening"
            @click="close"
          >
            {{ result ? '关闭' : '取消' }}
          </button>
          <button
            v-if="result"
            type="button"
            class="document-transfer__button document-transfer__button--primary"
            :disabled="opening"
            @click="openDocument"
          >
            打开文档
          </button>
          <button
            v-else
            type="button"
            class="document-transfer__button document-transfer__button--primary"
            :disabled="!file || !allowed"
            @click="run"
          >
            {{ attempted ? '重试导入' : '导入' }}
          </button>
        </template>
      </div>
    </template>
  </VoexModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { VoexModal } from '@/plugins/voex-modal';
import { authUser } from '@/service/auth-session';
import { importDocumentFile, type DocumentImportResult } from '@/service/api/document-transfer-api';
import type { CreateDocumentResult } from '@/service/api/document-api';
import { errorMessage } from '@/utils/error';
import { randomUUID } from '@/utils/id';
import { useNotificationStore } from '@/stores/notification';
import TransferWarnings from './TransferWarnings.vue';

const props = defineProps<{
  projectKey: string;
  folderKey: string;
  targetName: string;
  canImport: boolean;
  onImported: (document: CreateDocumentResult) => void;
}>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const route = useRoute();
const notification = useNotificationStore();
const inputId = useId();
const fileInput = ref<HTMLInputElement>();
const file = shallowRef<File | null>(null);
const busy = ref(false);
const opening = ref(false);
const attempted = ref(false);
const progress = ref<number | null>(null);
const status = ref('');
const error = ref('');
const result = ref<DocumentImportResult | null>(null);
const allowed = computed(() => !!authUser.value && props.canImport);
let requestId = '';
let controller: AbortController | undefined;
let active = true;
let openingTimer: ReturnType<typeof setTimeout> | undefined;

function formatSize(size: number) {
  return size < 1024 * 1024
    ? `${Math.ceil(size / 1024)} KiB`
    : `${(size / 1024 / 1024).toFixed(1)} MiB`;
}
function selectFile(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0];
  if (!selected || busy.value) return;
  error.value = '';
  status.value = '';
  file.value = null;
  attempted.value = false;
  const extension = selected.name.split('.').pop()?.toLowerCase();
  const limit = extension === 'md' ? 2 * 1024 * 1024 : 512 * 1024 * 1024;
  if (!['md', 'voex'].includes(extension ?? ''))
    error.value = '请选择 .voex 或 .md 文件，不支持 Markdown ZIP 导入。';
  else if (selected.size > limit)
    error.value = `文件过大，${extension === 'md' ? 'Markdown 最多 2 MiB' : 'Voex 最多 512 MiB'}。`;
  else {
    file.value = selected;
    requestId = randomUUID();
  }
  if (error.value && fileInput.value) fileInput.value.value = '';
}
function cancel() {
  controller?.abort();
  controller = undefined;
  busy.value = false;
  progress.value = null;
  status.value = '';
  error.value = '已取消等待。服务器可能已完成导入；重试将确认同一次导入结果。';
}
function close() {
  if (!busy.value && !opening.value) emit('close');
}
async function openDocument() {
  if (!active || !result.value || opening.value) return;
  clearTimeout(openingTimer);
  opening.value = true;
  error.value = '';
  try {
    await router.push({ name: 'edit', params: { file_key: result.value.document.file_key } });
    if (active) emit('close');
  } catch (cause) {
    if (active) error.value = errorMessage(cause, '文件已导入，打开失败，可再次打开或从目录进入。');
  } finally {
    opening.value = false;
  }
}
async function run() {
  if (busy.value || result.value || !file.value || !allowed.value) return;
  const request = new AbortController();
  controller = request;
  const account = authUser.value?.id;
  const location = route.fullPath;
  const current = () =>
    active &&
    controller === request &&
    !request.signal.aborted &&
    account === authUser.value?.id &&
    location === route.fullPath;
  busy.value = true;
  attempted.value = true;
  progress.value = 0;
  status.value = '正在上传文件…';
  error.value = '';
  try {
    const imported = await importDocumentFile(
      file.value,
      props.projectKey,
      props.folderKey,
      requestId,
      request.signal,
      (percent) => {
        if (!current()) return;
        progress.value = percent === 100 ? null : percent;
        status.value =
          percent === 100
            ? '上传完成，正在解析并创建文档…'
            : percent === null
              ? '正在上传文件…'
              : `正在上传文件 ${percent}%`;
      }
    );
    if (!current()) return;
    result.value = imported;
    const path = [imported.document.project_name, ...imported.document.folder_path].join(' / ');
    status.value = imported.warnings.length
      ? `已导入到 ${path}。请查看下方处理提示。`
      : `已导入到 ${path}，即将打开文档。`;
    // Keep a committed import separate from follow-up navigation/refresh failures.
    // 导入提交成功后，后续导航或刷新失败应单独处理。
    props.onImported(imported.document);
    notification.show('文档已导入', 'success');
    if (!imported.warnings.length) openingTimer = setTimeout(() => void openDocument(), 1000);
  } catch (cause) {
    if (current()) {
      status.value = result.value ? '文档已导入。' : '';
      error.value = errorMessage(
        cause,
        result.value ? '文档已导入，目录刷新失败，可直接打开文档。' : '导入失败，请重试'
      );
    }
  } finally {
    if (controller === request) {
      busy.value = false;
      progress.value = null;
      controller = undefined;
    }
  }
}
watch(allowed, (value) => {
  if (!value && busy.value && !result.value) cancel();
});
watch(
  [() => props.projectKey, () => props.folderKey, () => authUser.value?.id, () => route.fullPath],
  () => {
    controller?.abort();
    clearTimeout(openingTimer);
    emit('close');
  }
);
onBeforeUnmount(() => {
  active = false;
  controller?.abort();
  clearTimeout(openingTimer);
});
</script>

<style lang="stylus">
@import './document-transfer.styl'
</style>
