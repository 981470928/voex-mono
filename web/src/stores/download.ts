import { computed, onScopeDispose, reactive, ref } from 'vue';
import { defineStore } from 'pinia';
import { isAxiosError, isCancel } from 'axios';
import { downloadFile, type DownloadOptions } from '@/service/api/upload-api';
import { downloadSharedAttachment } from '@/service/api/share-api';
import { downloadRecentAttachment } from '@/service/api/recent-api';
import { useNotificationStore } from './notification';

export type DownloadStatus =
  'queued' | 'downloading' | 'saving' | 'completed' | 'canceled' | 'failed';

export interface DownloadItem {
  id: number;
  hash: string;
  name: string;
  status: DownloadStatus;
  loaded: number;
  total: number | null;
  error: string;
}

type DownloadSource =
  { kind: 'document' | 'recent'; fileKey: string } | { kind: 'share'; token: string };

interface DownloadTask {
  item: DownloadItem;
  source?: DownloadSource;
  controller: AbortController;
}

const MAX_CONCURRENT_DOWNLOADS = 2;
const MAX_FINISHED_RECORDS = 20;

export function isDownloadActive(item: DownloadItem) {
  return item.status === 'queued' || item.status === 'downloading' || item.status === 'saving';
}

export const useDownloadStore = defineStore('download', () => {
  // Reactive state contains metadata only; blobs, credentials and requests are never cached here.
  const items = ref<DownloadItem[]>([]);
  const expanded = ref(false);
  const activeCount = computed(() => items.value.filter(isDownloadActive).length);
  const notification = useNotificationStore();
  const tasks = new Map<string, DownloadTask>();
  let nextId = 0;
  let running = 0;
  let disposed = false;

  function trimRecords() {
    const finished = items.value.filter((item) => !isDownloadActive(item));
    const removed = new Set(
      finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_RECORDS)).map((item) => item.id)
    );
    items.value = items.value.filter((item) => !removed.has(item.id));
  }

  function enqueue(file: { hash: string; name: string }, source: DownloadSource) {
    const hash = file.hash.trim().toLowerCase();
    if (!hash || disposed) return;
    expanded.value = true;
    if (tasks.has(hash)) {
      notification.show('该文件正在下载，请在下载列表查看进度', 'info');
      return;
    }
    const item = reactive<DownloadItem>({
      id: ++nextId,
      hash,
      name: file.name,
      status: 'queued',
      loaded: 0,
      total: null,
      error: '',
    });
    items.value.push(item);
    tasks.set(hash, { item, source: { ...source }, controller: new AbortController() });
    trimRecords();
    pump();
  }

  function pump() {
    if (disposed) return;
    for (const task of tasks.values()) {
      if (running >= MAX_CONCURRENT_DOWNLOADS) break;
      if (task.item.status !== 'queued') continue;
      running++;
      task.item.status = 'downloading';
      void run(task);
    }
  }

  async function run(task: DownloadTask) {
    const { item, controller } = task;
    let blob: Blob | null;
    let objectUrl: string | undefined;
    try {
      const source = task.source;
      if (!source) return;
      const options: DownloadOptions = {
        signal: controller.signal,
        onDownloadProgress: (event) => {
          if (controller.signal.aborted || item.status !== 'downloading') return;
          item.loaded = event.loaded;
          item.total = event.total && event.total > 0 ? event.total : null;
        },
      };
      blob =
        source.kind === 'share'
          ? await downloadSharedAttachment(source.token, item.hash, options)
          : source.kind === 'recent'
            ? await downloadRecentAttachment(source.fileKey, item.hash, options)
            : await downloadFile(source.fileKey, item.hash, options);
      // An aborted/replaced request must never trigger a browser download.
      if (controller.signal.aborted || disposed) return;
      item.loaded = blob.size;
      item.total = blob.size;
      objectUrl = URL.createObjectURL(blob);
      blob = null;
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = item.name;
      link.rel = 'noreferrer';
      link.hidden = true;
      document.body.append(link);
      try {
        item.status = 'saving';
        link.click();
      } finally {
        link.remove();
      }
      // Let the browser consume the click before revoking the URL in the next task.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      item.status = 'completed';
    } catch (cause) {
      if (controller.signal.aborted || isCancel(cause)) {
        item.status = 'canceled';
      } else {
        item.status = 'failed';
        item.error = isAxiosError(cause)
          ? cause.response?.status === 401 || cause.response?.status === 403
            ? '无权下载，请确认登录状态或分享链接后重新下载'
            : cause.response?.status === 404
              ? '附件不存在或分享链接已失效'
              : !cause.response
                ? '无法连接服务器，请检查网络后从附件列表重新下载'
                : '附件下载失败，请从附件列表重新下载'
          : '附件下载失败，请从附件列表重新下载';
        notification.show('文件下载失败，请在下载列表查看详情', 'error');
      }
    } finally {
      // eslint-disable-next-line no-useless-assignment -- Release file bytes on every exit path.
      blob = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      task.source = undefined;
      // Canceling and immediately enqueueing the same hash creates a different task.
      if (tasks.get(item.hash) === task) tasks.delete(item.hash);
      running--;
      trimRecords();
      pump();
    }
  }

  function cancel(id: number) {
    const item = items.value.find((entry) => entry.id === id);
    if (!item || (item.status !== 'queued' && item.status !== 'downloading')) return;
    const task = tasks.get(item.hash);
    if (!task || task.item.id !== id) return;
    item.status = 'canceled';
    task.controller.abort();
    task.source = undefined;
    tasks.delete(item.hash);
    trimRecords();
    pump();
  }

  function clearFinished() {
    items.value = items.value.filter(isDownloadActive);
  }

  onScopeDispose(() => {
    disposed = true;
    for (const task of tasks.values()) {
      task.controller.abort();
      task.source = undefined;
    }
    tasks.clear();
  });

  return { items, expanded, activeCount, enqueue, cancel, clearFinished };
});
