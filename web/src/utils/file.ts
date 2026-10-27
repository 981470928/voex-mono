/**
 * 常见 MIME 类型到文件扩展名的映射
 */
const MIME_TO_EXTENSION: Record<string, string> = {
  // 图片
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/x-icon': '.ico',

  // 文档
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/html': '.html',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/json': '.json',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'application/rtf': '.rtf',
  'application/epub+zip': '.epub',

  // 音频
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/midi': '.midi',
  'audio/x-midi': '.midi',

  // 视频
  'video/mp4': '.mp4',
  'video/mpeg': '.mpeg',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'video/x-ms-wmv': '.wmv',

  // 压缩包
  'application/zip': '.zip',
  'application/gzip': '.gz',
  'application/x-tar': '.tar',
  'application/x-bzip2': '.bz2',
  'application/x-7z-compressed': '.7z',
  'application/x-rar-compressed': '.rar',

  // 其他
  'application/octet-stream': '.bin',
  'application/javascript': '.js',
  'application/typescript': '.ts',
  'application/wasm': '.wasm',
  'application/font-woff': '.woff',
  'application/font-woff2': '.woff2',
  'application/vnd.android.package-archive': '.apk',
};

const EXTENSION_TO_MIME: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(MIME_TO_EXTENSION).map(([mime, extension]) => [extension, mime])
  ),
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.svgz': 'image/svg+xml',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
};

const MIME_ALIASES: Record<string, string> = {
  'application/xmind': 'application/vnd.xmind.workbook',
  'image/x-photoshop': 'image/vnd.adobe.photoshop',
  'application/vnd.openxmlformats-officedocument.drawingml.drawing':
    'application/vnd.ms-visio.drawing',
};

/** 补全缺失 MIME、统一已知别名，同时保留文件名、内容和修改时间。 */
export function fillMimeTypeIfNeed(file: File): File {
  const type = file.type
    ? MIME_ALIASES[file.type] || file.type
    : EXTENSION_TO_MIME[getFileExtension(file.name)];
  if (!type || type === file.type) return file;
  return new File([file], file.name, { type, lastModified: file.lastModified });
}

/**
 * 获取文件扩展名（包含点号）
 * @param filename 文件名
 * @returns 扩展名（如 '.txt'）或空字符串
 */
export function getFileExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === 0 || lastDotIndex === filename.length - 1) {
    return '';
  }
  return filename.slice(lastDotIndex).toLowerCase();
}

/**
 * 检查文件是否有扩展名
 * @param filename 文件名
 * @returns 是否有扩展名
 */
export function hasFileExtension(filename: string): boolean {
  return getFileExtension(filename) !== '';
}

/**
 * 根据 MIME 类型获取对应的文件扩展名
 * @param mimeType MIME 类型
 * @returns 文件扩展名（如 '.pdf'）或空字符串
 */
export function getExtensionByMimeType(mimeType: string): string {
  // 标准化 MIME 类型（去除参数，如 charset）
  const normalizedMime = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_TO_EXTENSION[normalizedMime] || '';
}

/**
 * 补全文件后缀
 * 如果文件已有后缀，直接返回原文件名；
 * 如果文件没有后缀且提供了 mimeType，则根据 mimeType 补全后缀；
 * 如果都没有，返回原文件名
 * @param filename 文件名
 * @param mimeType MIME 类型（可选）
 * @returns 补全后缀后的文件名
 */
export function ensureFileExtension(filename: string, mimeType?: string): string {
  // 如果已有扩展名，直接返回
  if (hasFileExtension(filename)) {
    return filename;
  }

  // 如果没有扩展名但有 mimeType，尝试补全
  if (mimeType) {
    const extension = getExtensionByMimeType(mimeType);
    if (extension) {
      return `${filename}${extension}`;
    }
  }

  // 都没有则返回原文件名
  return filename;
}

/**
 * 从完整路径中提取文件名
 * @param path 文件路径
 * @returns 文件名
 */
export function getFileNameFromPath(path: string): string {
  return path.split('/').pop() || path.split('\\').pop() || path;
}

/**
 * 生成唯一的文件名（避免重名）
 * @param filename 原文件名
 * @param existingNames 已存在的文件名列表
 * @returns 唯一的文件名
 */
export function generateUniqueFilename(filename: string, existingNames: string[]): string {
  if (!existingNames.includes(filename)) {
    return filename;
  }

  const extension = getFileExtension(filename);
  const nameWithoutExt = extension ? filename.slice(0, -extension.length) : filename;

  let counter = 1;
  let newFilename: string;

  do {
    newFilename = `${nameWithoutExt}(${counter})${extension}`;
    counter++;
  } while (existingNames.includes(newFilename));

  return newFilename;
}
