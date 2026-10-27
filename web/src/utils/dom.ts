import { fillMimeTypeIfNeed } from './file';

/** 文件选择器的常用 accept；ALL 不限制文件类型，业务校验仍由调用方负责。 */
export const FILE_ACCEPT = {
  ALL: '',
  IMAGE: 'image/*',
  AVATAR: 'image/jpeg,image/png,image/webp',
  AUDIO: 'audio/*',
  VIDEO: 'video/*',
  PDF: 'application/pdf,.pdf',
  WORD: '.doc,.docx',
  EXCEL: '.xls,.xlsx,.csv',
  POWERPOINT: '.ppt,.pptx',
  DOCUMENT: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.rtf',
  TEXT: 'text/plain,.txt',
  MARKDOWN: 'text/markdown,.md,.markdown',
  JSON: 'application/json,.json',
  ARCHIVE: '.zip,.rar,.7z,.tar,.gz,.bz2',
} as const;

let cancelFileSelection: (() => void) | undefined;

/** 默认多选；取消选择返回空数组，并移除临时 input。 */
export function originalGetImportFiles(
  accept: string = FILE_ACCEPT.ALL,
  multiple = true
): Promise<File[]> {
  cancelFileSelection?.();

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = accept === '*' ? FILE_ACCEPT.ALL : accept;
    input.style.position = 'absolute';
    input.style.right = '200%';
    input.style.margin = '0';

    const cleanup = () => {
      input.remove();
      if (cancelFileSelection === cancel) cancelFileSelection = undefined;
    };
    const cancel = () => {
      cleanup();
      resolve([]);
    };
    cancelFileSelection = cancel;

    input.addEventListener(
      'change',
      () => {
        const files = Array.from(input.files ?? [], fillMimeTypeIfNeed);
        cleanup();
        resolve(files);
      },
      { once: true }
    );
    input.addEventListener('cancel', cancel, { once: true });
    input.addEventListener('abort', cancel, { once: true });

    try {
      document.body.appendChild(input);
      input.click();
    } catch (cause) {
      cleanup();
      reject(cause);
    }
  });
}
