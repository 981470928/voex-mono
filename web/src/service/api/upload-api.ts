/** ---------- upload APIs ---------- / 上传 API */
import http from './https';
import { isAxiosError, type AxiosRequestConfig } from 'axios';
import type { ApiError } from './index';
import type { UploadResult, FileInfo } from './document-api';
import type { Creator } from '@/service/auth-session';

export interface AssetResult {
  id: string;
  name: string;
  url: string;
  path: string;
  size: number;
  mime: string;
  creator: Creator;
}

export function uploadAsset(
  file: File,
  path: string,
  options?: { signal?: AbortSignal; onProgress?: (percent: number) => void }
) {
  const form = new FormData();
  form.append('path', path);
  form.append('file', file);
  return http.post<unknown, AssetResult>('/assets/upload', form, {
    timeout: 300000,
    signal: options?.signal,
    onUploadProgress: (event) => {
      if (event.total) options?.onProgress?.(Math.round((event.loaded / event.total) * 100));
    },
  });
}

export interface UploadProgress {
  uploadId: string;
  status: 'UPLOADING' | 'COMPLETED' | 'FAILED';
  totalBytes: number;
  persistedBytes: number;
  uploadedPercent: number;
}
/** 上传文件 */
export function uploadFile(
  fileKey: string,
  file: File,
  file_name?: string,
  mime?: string,
  onUploadProgress?: (percent: number) => void
) {
  const formData = new FormData();
  formData.append('fileKey', fileKey);
  formData.append('file', file);
  if (file_name) formData.append('file_name', file_name);
  if (mime) formData.append('mime', mime);

  const config: AxiosRequestConfig = {
    timeout: 300000,
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onUploadProgress && e.total) {
        onUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  };

  return http.post<ApiError, UploadResult>('/upload', formData, config);
}

/** 查询文档下全部文件 */
export function listFiles(fileKey: string) {
  return http.get<ApiError, FileInfo[]>(`/files/${fileKey}`);
}

export type DownloadOptions = Pick<AxiosRequestConfig, 'signal' | 'onDownloadProgress'>;

/** 文件传输不设超时，由调用方主动中止。 */
export function downloadFile(
  fileKey: string,
  hash: string,
  options: DownloadOptions = {}
): Promise<Blob> {
  return http.get<unknown, Blob>(
    `/download/${encodeURIComponent(fileKey)}/${encodeURIComponent(hash)}`,
    { ...options, responseType: 'blob', timeout: 0 }
  );
}

let imageFetchQueue: Promise<void> = Promise.resolve();

/** 串行读取，兼容一次粘贴多张外链图片与后端的单用户并发限制。 */
export function fetchRemoteImage(fileKey: string, url: string, signal: AbortSignal): Promise<Blob> {
  const request = imageFetchQueue.then(() => {
    signal.throwIfAborted();
    return requestRemoteImage(fileKey, url, signal);
  });
  imageFetchQueue = request.then(
    () => undefined,
    () => undefined
  );
  return request;
}

/** 在有文档编辑权限时读取公网图片，避免浏览器跨域读取限制。 */
async function requestRemoteImage(
  fileKey: string,
  url: string,
  signal: AbortSignal
): Promise<Blob> {
  try {
    return await http.post<unknown, Blob>(
      '/images/fetch',
      { fileKey, url },
      { signal, responseType: 'blob', timeout: 30000 }
    );
  } catch (cause) {
    if (isAxiosError(cause) && cause.response?.data instanceof Blob) {
      const body: unknown = await cause.response.data
        .text()
        .then((text: string) => JSON.parse(text))
        .catch(() => null);
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string')
        throw new Error(body.error, { cause });
    }
    throw cause;
  }
}

/** 查询上传进度 */
export function getUploadProgress(fileKey: string, hash: string) {
  return http.get<ApiError, UploadProgress>(`/upload-progress/${fileKey}/${hash}`);
}

/** 删除附件 */
export function deleteAttachment(fileKey: string, hash: string) {
  return http.delete<ApiError, { success: true }>(`/attachment/${fileKey}/${hash}`);
}
