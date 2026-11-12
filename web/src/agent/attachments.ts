export const AI_ATTACHMENT_ACCEPT =
  '.jpg,.jpeg,.png,.gif,.webp,.md,.txt,.doc,.docx,.ppt,.pptx,.xls,.xlsx';
export const AI_ATTACHMENT_MAX_COUNT = 4;
export const AI_ATTACHMENT_MAX_SIZE = 5 * 1024 * 1024;
export const AI_ATTACHMENT_TOTAL_SIZE = 12 * 1024 * 1024;
const extensions = new Set(AI_ATTACHMENT_ACCEPT.split(','));

export function validateAIAttachment(file: File): string {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!extensions.has(extension))
    return '仅支持 JPG、PNG、GIF、WebP、MD、TXT、DOC/DOCX、PPT/PPTX、XLS/XLSX';
  if (!file.size) return '文件为空，请选择有内容的文件';
  if (file.size > AI_ATTACHMENT_MAX_SIZE) return '单个文件不能超过 5 MiB';
  return '';
}

export function attachmentSize(size: number): string {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.ceil(size / 1024))} KiB`
    : `${(size / 1024 / 1024).toFixed(1)} MiB`;
}
