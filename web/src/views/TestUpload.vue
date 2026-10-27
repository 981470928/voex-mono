<template>
  <div class="test-upload">
    <h1>文件上传测试</h1>

    <!-- 文档管理 -->
    <section class="card">
      <h2>文档管理</h2>
      <div class="row">
        <input v-model="docName" placeholder="文档名称 (默认 untitled)" />
        <button @click="handleCreateDoc">创建文档</button>
      </div>
      <div v-if="currentKey" class="info">
        当前文档: <code>{{ currentKey }}</code> ({{ docName || 'untitled' }})
      </div>
    </section>

    <!-- 文件上传 -->
    <section class="card">
      <h2>文件上传</h2>
      <div class="row">
        <button type="button" :disabled="uploading || choosing" @click="chooseFile">
          选择文件
        </button>
        <span class="test-upload__filename" :title="selectedFile?.name" aria-live="polite">
          {{ selectedFile?.name || '未选择文件' }}
        </span>
        <button :disabled="!currentKey || !selectedFile || uploading" @click="handleUpload">
          {{ uploading ? '上传中...' : '上传' }}
        </button>
      </div>

      <!-- 上传进度条 -->
      <div v-if="uploading || uploadPercent > 0" class="progress-wrap">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: uploadPercent + '%' }"></div>
        </div>
        <span class="progress-text">{{ uploadPercent }}%</span>
      </div>
    </section>

    <!-- 服务端进度查询 -->
    <section v-if="lastHash" class="card">
      <h2>上传进度 (服务端)</h2>
      <button @click="handleQueryProgress">查询进度</button>
      <pre v-if="progressInfo">{{ JSON.stringify(progressInfo, null, 2) }}</pre>
    </section>

    <!-- 文件列表 -->
    <section class="card">
      <h2>文件列表</h2>
      <button :disabled="!currentKey" @click="handleListFiles">刷新列表</button>
      <table v-if="fileList.length" class="file-table">
        <thead>
          <tr>
            <th>文件名</th>
            <th>MIME</th>
            <th>Hash</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in fileList" :key="f.hash">
            <td>{{ f.name }}</td>
            <td>{{ f.mime }}</td>
            <td class="hash-cell">{{ f.hash.slice(0, 16) }}...</td>
            <td><button @click="handleDownload(f.hash, f.name)">下载</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">暂无文件</p>
      <DownloadQueue />
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import DownloadQueue from '@/components/DownloadQueue.vue';
import { createDocument, type FileInfo } from '@/service/api/document-api';
import { uploadFile, listFiles, getUploadProgress } from '@/service/api/upload-api';
import type { UploadProgress } from '@/service/api/upload-api';
import { errorMessage } from '@/utils/error';
import { useNotificationStore } from '@/stores/notification';
import { useDownloadStore } from '@/stores/download';
import { FILE_ACCEPT, originalGetImportFiles } from '@/utils/dom';
const notification = useNotificationStore();
const downloadStore = useDownloadStore();

const docName = ref('');
const currentKey = ref('');
const choosing = ref(false);
const selectedFile = ref<File | null>(null);
const uploading = ref(false);
const uploadPercent = ref(0);
const lastHash = ref('');
const progressInfo = ref<UploadProgress | null>(null);
const fileList = ref<FileInfo[]>([]);

async function chooseFile() {
  if (uploading.value || choosing.value) return;
  choosing.value = true;
  try {
    const [file] = await originalGetImportFiles(FILE_ACCEPT.ALL, false);
    if (file) selectedFile.value = file;
  } catch (cause) {
    notification.show(errorMessage(cause, '无法选择文件，请重试'), 'error');
  } finally {
    choosing.value = false;
  }
}

/** 创建文档 */
async function handleCreateDoc() {
  try {
    const res = await createDocument({ file_name: docName.value || undefined });
    currentKey.value = res.file_key;
    docName.value = res.file_name;
    fileList.value = [];
  } catch (err: unknown) {
    notification.show(errorMessage(err), 'error');
  }
}

/** 上传文件 */
async function handleUpload() {
  if (!currentKey.value || !selectedFile.value) return;
  uploading.value = true;
  uploadPercent.value = 0;

  try {
    const res = await uploadFile(
      currentKey.value,
      selectedFile.value,
      selectedFile.value.name,
      undefined,
      (percent) => {
        uploadPercent.value = percent;
      }
    );
    lastHash.value = res.hash;
    uploading.value = false;
    // 刷新文件列表
    await handleListFiles();
  } catch (err: unknown) {
    uploading.value = false;
    notification.show(errorMessage(err), 'error');
  }
}

/** 查询服务端上传进度 */
async function handleQueryProgress() {
  if (!currentKey.value || !lastHash.value) return;
  try {
    progressInfo.value = await getUploadProgress(currentKey.value, lastHash.value);
  } catch {
    progressInfo.value = null;
  }
}

/** 查询文件列表 */
async function handleListFiles() {
  if (!currentKey.value) return;
  try {
    fileList.value = await listFiles(currentKey.value);
  } catch {
    fileList.value = [];
  }
}

/** 下载文件 */
function handleDownload(hash: string, name: string) {
  if (!currentKey.value) return;
  downloadStore.enqueue({ hash, name }, { kind: 'document', fileKey: currentKey.value });
}
</script>

<style scoped lang="stylus">
.test-upload
  max-width 720px
  margin 40px auto
  padding 0 20px
  font-family -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
  color #333

h1
  font-size 24px
  margin-bottom 24px

h2
  font-size 16px
  margin-bottom 12px
  color #555

.card
  background #fff
  border 1px solid #e5e5e5
  border-radius 8px
  padding 20px
  margin-bottom 16px

.row
  display flex
  gap 12px
  align-items center
  margin-bottom 12px

  input[type="text"],
  input:not([type])
    flex 1
    padding 8px 12px
    border 1px solid #ddd
    border-radius 6px
    font-size 14px

.test-upload__filename
  min-width 0
  overflow hidden
  text-overflow ellipsis
  white-space nowrap
  font-size 14px

button
  padding 8px 16px
  border none
  border-radius 6px
  background #409eff
  color #fff
  font-size 14px
  cursor pointer
  white-space nowrap

  &:hover
    background #337ecc

  &:disabled
    background #a0cfff
    cursor not-allowed

.info
  font-size 14px
  color #666

  code
    background #f5f5f5
    padding 2px 6px
    border-radius 4px

.progress-wrap
  display flex
  align-items center
  gap 12px
  margin-top 8px

.progress-bar
  flex 1
  height 8px
  background #eee
  border-radius 4px
  overflow hidden

.progress-fill
  height 100%
  background #409eff
  border-radius 4px
  transition width 0.2s

.progress-text
  font-size 14px
  font-weight 600
  min-width 40px
  text-align right

pre
  background #f8f8f8
  padding 12px
  border-radius 6px
  font-size 13px
  overflow-x auto
  margin-top 8px

.file-table
  width 100%
  border-collapse collapse
  margin-top 8px
  font-size 14px

  th, td
    padding 8px 12px
    border-bottom 1px solid #eee
    text-align left

  th
    font-weight 600
    color #666

.hash-cell
  font-family monospace
  font-size 13px

.empty
  color #999
  font-size 14px
</style>
