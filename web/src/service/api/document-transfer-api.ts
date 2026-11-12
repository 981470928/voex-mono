import { isAxiosError } from 'axios';
import http from './https';
import type { ApiError } from './index';
import type { CreateDocumentResult } from './document-api';

export type ExportFormat = 'voex' | 'markdown';
export interface TransferWarning {
  code: string;
  message: string;
  name?: string;
  source?: string;
}
export interface DocumentExportResult {
  export_id: string;
  file_name: string;
  download_url: string;
  warnings: TransferWarning[];
}
export interface DocumentImportResult {
  document: CreateDocumentResult;
  warnings: TransferWarning[];
}

export function prepareDocumentExport(
  fileKey: string,
  format: ExportFormat,
  preserveStyles: boolean,
  signal: AbortSignal
) {
  return http.post<ApiError, DocumentExportResult>(
    `/document/${encodeURIComponent(fileKey)}/export`,
    { format, preserve_styles: format === 'markdown' && preserveStyles },
    { signal, timeout: 300000 }
  );
}

export async function downloadDocumentExport(
  result: DocumentExportResult,
  signal: AbortSignal,
  progress: (percent: number | null) => void
): Promise<Blob> {
  const expected = `/api/document-exports/${encodeURIComponent(result.export_id)}`;
  if (result.download_url !== expected) throw new Error('下载地址无效，请重新导出');
  try {
    return await http.get<ApiError, Blob>(expected.slice(4), {
      signal,
      timeout: 300000,
      responseType: 'blob',
      onDownloadProgress: ({ loaded, total }) =>
        progress(total ? Math.min(100, Math.round((loaded / total) * 100)) : null),
    });
  } catch (cause) {
    if (isAxiosError(cause) && cause.response?.data instanceof Blob) {
      let data: { error?: unknown; message?: unknown } = {};
      try {
        data = JSON.parse(await cause.response.data.text());
      } catch {
        // Keep the original HTTP error if the body is not JSON.
        // 响应体不是 JSON 时，保留原始 HTTP 错误。
      }
      const message = data.error ?? data.message;
      if (typeof message === 'string') throw new Error(message, { cause });
    }
    throw cause;
  }
}

export function importDocumentFile(
  file: File,
  projectKey: string,
  folderKey: string,
  requestId: string,
  signal: AbortSignal,
  progress: (percent: number | null) => void
) {
  const data = new FormData();
  data.append('file', file);
  data.append('project_key', projectKey);
  data.append('folder_key', folderKey);
  data.append('request_id', requestId);
  return http.post<ApiError, DocumentImportResult>('/document/import', data, {
    signal,
    timeout: 300000,
    onUploadProgress: ({ loaded, total }) =>
      progress(total ? Math.min(100, Math.round((loaded / total) * 100)) : null),
  });
}

export function releaseDocumentExport(exportId: string) {
  return http.delete<ApiError, { success: boolean }>(
    `/document-exports/${encodeURIComponent(exportId)}`
  );
}
