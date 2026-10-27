import { ref } from 'vue';
import { defineStore } from 'pinia';
import { uploadFile, getUploadProgress } from '@/service/api/upload-api';
import type { FileInfo } from '@/service/api/document-api';
import { ensureFileExtension } from '@/utils/file';
import { useNotificationStore } from './notification';

export type UploadStatus = 'pending' | 'uploading' | 'success' | 'failed';

export interface UploadItem {
  name: string;
  hash: string;
  progress: number;
  status: UploadStatus;
}

export const useUploadStore = defineStore('upload', () => {
  const uploadingFiles = ref<UploadItem[]>([]);
  const notification = useNotificationStore();

  async function uploadFiles(
    files: FileList | File[],
    docKey: string,
    onComplete?: () => void | Promise<void>
  ): Promise<FileInfo[]> {
    const tasks: Array<{ file: File; item: UploadItem }> = [];
    for (const file of Array.from(files)) {
      // 补全文件后缀（如果没有后缀且有 mimeType）
      const fileName = ensureFileExtension(file.name, file.type || undefined);
      tasks.push({
        file,
        item: { name: fileName, hash: '', progress: 0, status: 'pending' },
      });
    }
    uploadingFiles.value.push(...tasks.map(({ item }) => item));

    const results = await Promise.all(
      tasks.map(async ({ file, item }): Promise<FileInfo | null> => {
        item.status = 'uploading';

        try {
          const fileName = ensureFileExtension(file.name, file.type || undefined);
          const res = await uploadFile(docKey, file, fileName, file.type || undefined, (pct) => {
            item.progress = pct;
          });
          item.hash = res.hash;
          const completed = await pollProgress(docKey, item);
          if (!completed) return null;
          return { hash: res.hash, name: fileName, mime: file.type, creator: res.creator };
        } catch (e: unknown) {
          item.status = 'failed';
          item.progress = 0;
          removeUploadingItem(item);
          const msg = e instanceof Error ? e.message : '上传失败';
          notification.show(msg, 'error');
          return null;
        }
      })
    );

    await onComplete?.();
    return results.filter((file): file is FileInfo => file !== null);
  }

  function removeUploadingItem(item: UploadItem) {
    uploadingFiles.value = uploadingFiles.value.filter((uploading) => uploading !== item);
  }

  function pollProgress(docKey: string, item: UploadItem): Promise<boolean> {
    return new Promise((resolve) => {
      let polling = false;
      const timer = setInterval(async () => {
        if (polling) return;
        polling = true;

        try {
          const prog = await getUploadProgress(docKey, item.hash);
          item.progress = prog.uploadedPercent;
          if (prog.status === 'COMPLETED') {
            clearInterval(timer);
            item.status = 'success';
            removeUploadingItem(item);
            resolve(true);
          } else if (prog.status === 'FAILED') {
            clearInterval(timer);
            item.status = 'failed';
            removeUploadingItem(item);
            resolve(false);
          }
        } catch {
          clearInterval(timer);
          item.status = 'failed';
          removeUploadingItem(item);
          resolve(false);
        } finally {
          polling = false;
        }
      }, 800);
    });
  }

  return { uploadingFiles, uploadFiles };
});
