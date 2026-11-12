<template>
  <VoexModal
    :model-value="true"
    title="导出文档"
    :width="520"
    :busy="busy"
    :mask-closable="false"
    @close="close"
  >
    <div class="document-transfer">
      <p class="document-transfer__name">{{ fileName }}</p>
      <fieldset v-if="!result" class="document-transfer__fieldset" :disabled="busy || !allowed">
        <legend>文件格式</legend>
        <label class="document-transfer__choice">
          <input v-model="format" type="radio" value="voex" name="document-export-format" />
          <span
            ><strong>Voex 文档（.voex）</strong
            ><span class="document-transfer__hint"
              >保留正文格式与全部附件，可再次导入 Voex。</span
            ></span
          >
        </label>
        <label class="document-transfer__choice">
          <input v-model="format" type="radio" value="markdown" name="document-export-format" />
          <span
            ><strong>Markdown 压缩包（.zip）</strong
            ><span class="document-transfer__hint"
              >包含 Markdown 和正文引用的附件，卡片展开为图片与文字。</span
            ></span
          >
        </label>
      </fieldset>
      <label v-if="!result && format === 'markdown'" class="document-transfer__checkbox">
        <input v-model="preserveStyles" type="checkbox" :disabled="busy || !allowed" />
        <span
          >保留文字颜色、高亮和字号<span class="document-transfer__hint"
            >使用 HTML 样式，显示效果取决于阅读器。字体、图片尺寸和对齐不保留。</span
          ></span
        >
      </label>
      <p v-if="!result" class="document-transfer__hint">
        外链图片保持原地址。缺失附件会在导出后列出。
      </p>
      <p v-if="result" class="document-transfer__name">{{ result.file_name }}</p>
      <p class="document-transfer__status" role="status" aria-live="polite">{{ status }}</p>
      <progress
        v-if="busy"
        class="document-transfer__progress"
        :value="progress ?? undefined"
        max="100"
        :aria-label="status"
      />
      <p v-if="!allowed" class="document-transfer__error" role="alert">
        需要登录并拥有文档写权限才能导出。
      </p>
      <p v-if="error" class="document-transfer__error" role="alert">{{ error }}</p>
      <TransferWarnings v-if="result" :warnings="result.warnings" />
    </div>
    <template #footer>
      <div class="document-transfer document-transfer__actions">
        <button v-if="busy" type="button" class="document-transfer__button" @click="cancel">
          取消等待
        </button>
        <template v-else>
          <button type="button" class="document-transfer__button" @click="close">
            {{ result ? '关闭' : '取消' }}
          </button>
          <button
            v-if="result"
            type="button"
            class="document-transfer__button"
            :disabled="!allowed"
            @click="reset"
          >
            重新导出
          </button>
          <button
            v-if="!downloaded"
            type="button"
            class="document-transfer__button document-transfer__button--primary"
            :disabled="!allowed"
            @click="run"
          >
            {{ result ? '重试下载' : '导出' }}
          </button>
        </template>
      </div>
    </template>
  </VoexModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { VoexModal } from '@/plugins/voex-modal';
import { authUser } from '@/service/auth-session';
import {
  prepareDocumentExport,
  downloadDocumentExport,
  releaseDocumentExport,
  type DocumentExportResult,
  type ExportFormat,
} from '@/service/api/document-transfer-api';
import { errorMessage } from '@/utils/error';
import TransferWarnings from './TransferWarnings.vue';

const props = defineProps<{
  fileKey: string;
  fileName: string;
  canExport: boolean;
  ensureSaved: () => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();
const format = ref<ExportFormat>('voex');
const preserveStyles = ref(false);
const busy = ref(false);
const result = ref<DocumentExportResult | null>(null);
const downloaded = ref(false);
const status = ref('');
const progress = ref<number | null>(null);
const error = ref('');
const allowed = computed(() => !!authUser.value && props.canExport);
let controller: AbortController | undefined;
let active = true;

function cancel() {
  controller?.abort();
  controller = undefined;
  busy.value = false;
  progress.value = null;
  status.value = '';
  error.value = '已取消等待，可重试。';
}
function close() {
  if (!busy.value) emit('close');
}
function release() {
  if (result.value) void releaseDocumentExport(result.value.export_id).catch(() => undefined);
}
function reset() {
  release();
  result.value = null;
  downloaded.value = false;
  error.value = '';
  status.value = '';
}
async function run() {
  if (busy.value || !allowed.value) return;
  const request = new AbortController();
  controller = request;
  const fileKey = props.fileKey;
  const account = authUser.value?.id;
  const current = () =>
    active &&
    controller === request &&
    !request.signal.aborted &&
    props.fileKey === fileKey &&
    authUser.value?.id === account &&
    allowed.value;
  busy.value = true;
  error.value = '';
  progress.value = null;
  try {
    if (!result.value) {
      status.value = '正在确认文档已保存…';
      await props.ensureSaved();
      if (!current()) return;
      status.value = '正在生成导出文件…';
      const prepared = await prepareDocumentExport(
        fileKey,
        format.value,
        preserveStyles.value,
        request.signal
      );
      if (!current()) return;
      result.value = prepared;
    }
    status.value = '正在下载导出文件…';
    const prepared = result.value;
    if (!prepared) return;
    const blob = await downloadDocumentExport(prepared, request.signal, (percent) => {
      if (current()) {
        progress.value = percent;
        status.value = percent === null ? '正在下载导出文件…' : `正在下载导出文件 ${percent}%`;
      }
    });
    if (!current()) return;
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = prepared.file_name;
      link.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    downloaded.value = true;
    release();
    status.value = prepared.warnings.length
      ? '已开始保存文件，请查看下方处理提示。'
      : '已开始保存文件。';
  } catch (cause) {
    if (current()) {
      status.value = result.value ? '文件已生成，下载失败。可在 15 分钟内重试下载。' : '';
      error.value = errorMessage(cause, '导出失败，请重试');
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
  if (!value && busy.value) cancel();
});
watch([() => props.fileKey, () => authUser.value?.id], () => {
  controller?.abort();
  emit('close');
});
onBeforeUnmount(() => {
  active = false;
  controller?.abort();
  release();
});
</script>

<style lang="stylus">
@import './document-transfer.styl'
</style>
