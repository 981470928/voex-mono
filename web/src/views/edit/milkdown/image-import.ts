import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { FileInfo } from '@/service/api/document-api';

function imageAttachmentReference(src: string): { documentKey: string; hash: string } | null {
  const match = /^\/api\/download\/([^/]+)\/([^/]+)$/.exec(src);
  if (!match) return null;
  try {
    return { documentKey: decodeURIComponent(match[1]!), hash: decodeURIComponent(match[2]!) };
  } catch {
    return null;
  }
}

export function imageAttachmentHash(src: string): string | null {
  return imageAttachmentReference(src)?.hash ?? null;
}

export function createImportedImage(view: EditorView, file: FileInfo, documentKey: string) {
  const style = view.dom.ownerDocument.defaultView!.getComputedStyle(view.dom);
  const width = Math.max(
    16,
    Math.min(
      10000,
      Math.round(
        (view.dom.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / 2
      )
    )
  );
  return view.state.schema.nodes.image!.create({
    src: `/api/download/${encodeURIComponent(documentKey)}/${encodeURIComponent(file.hash)}`,
    alt: file.name,
    width,
  });
}

export interface ImageImportOptions {
  readonly: () => boolean;
  attachments: () => FileInfo[];
  documentKey: () => string;
  importFiles: (files: File[]) => Promise<FileInfo[]>;
  loadImage: (hash: string, signal: AbortSignal, documentKey?: string) => Promise<Blob>;
}

export function createImageImport(options: ImageImportOptions) {
  const requests = new Set<AbortController>();
  const loadRequests = new Set<AbortController>();
  const resources = new Map<string, Promise<string>>();
  const urls = new Set<string>();
  let disposed = false;
  let epoch = 0;

  async function importImages(view: EditorView, files: File[]): Promise<ProseMirrorNode[]> {
    if (disposed || options.readonly()) return [];
    if (files.some((file) => !file.type.startsWith('image/'))) throw new Error('请选择图片文件');
    const current = epoch;
    const imported = await options.importFiles(files);
    if (disposed || options.readonly() || current !== epoch || view.isDestroyed) return [];
    if (!imported.length) throw new Error('图片导入失败，请重试');
    return imported.map((file) => createImportedImage(view, file, options.documentKey()));
  }

  async function importSource(view: EditorView, node: ProseMirrorNode): Promise<ProseMirrorNode> {
    if (disposed || options.readonly()) throw new Error('图片导入已取消');
    const src = String(node.attrs.src ?? '');
    const hash = imageAttachmentHash(src);
    // 当前文档已有的附件直接复用，仍应用本次插入的默认尺寸。
    const existing = hash && options.attachments().find((file) => file.hash === hash);
    if (existing) {
      const image = createImportedImage(view, existing, options.documentKey());
      return image.type.create(
        { ...image.attrs, alt: node.attrs.alt, title: node.attrs.title },
        null,
        node.marks
      );
    }
    const reference = imageAttachmentReference(src);
    const url = new URL(src, window.location.href);
    if (!['https:', 'http:', 'data:', 'blob:'].includes(url.protocol))
      throw new Error('不支持的图片地址，请复制图片文件后重试');
    const request = new AbortController();
    requests.add(request);
    const timer = setTimeout(() => request.abort(), 30000);
    try {
      let blob: Blob;
      if (reference) {
        blob = await options.loadImage(reference.hash, request.signal, reference.documentKey);
      } else {
        const response = await fetch(url, { signal: request.signal, credentials: 'omit' });
        if (!response.ok) throw new Error('图片下载失败，请复制图片文件后重试');
        blob = await response.blob();
      }
      clearTimeout(timer);
      if (!blob.type.startsWith('image/')) throw new Error('图片地址未返回可用的图片');
      if (disposed || request.signal.aborted || options.readonly())
        throw new Error('图片导入已取消');
      const filename = reference
        ? node.attrs.alt || 'image'
        : ['data:', 'blob:'].includes(url.protocol)
          ? 'image'
          : url.pathname.split('/').pop() || 'image';
      const [image] = await importImages(view, [new File([blob], filename, { type: blob.type })]);
      if (!image) throw new Error('图片导入失败，请重试');
      return image.type.create(
        { ...image.attrs, alt: node.attrs.alt || filename, title: node.attrs.title },
        null,
        node.marks
      );
    } catch (cause) {
      if (cause instanceof TypeError)
        throw new Error('无法读取图片，请检查网络或复制图片文件后重试', { cause });
      throw cause;
    } finally {
      clearTimeout(timer);
      requests.delete(request);
    }
  }

  async function resolveSource(src: string): Promise<string> {
    const hash = imageAttachmentHash(src);
    if (!hash) return Promise.resolve(src);
    if (disposed) throw new Error('图片加载已取消');
    // 刷新时正文可能先于附件列表挂载；文件是否可读由鉴权下载接口判断。
    const cached = resources.get(hash);
    if (cached) return cached;
    const request = new AbortController();
    loadRequests.add(request);
    const resource = options
      .loadImage(hash, request.signal)
      .then((blob) => {
        if (disposed) throw new Error('图片加载已取消');
        const url = URL.createObjectURL(blob);
        urls.add(url);
        return url;
      })
      .catch((cause: unknown) => {
        resources.delete(hash);
        throw cause;
      })
      .finally(() => loadRequests.delete(request));
    resources.set(hash, resource);
    return resource;
  }

  function readonlyChanged() {
    epoch++;
    requests.forEach((request) => request.abort());
  }

  return {
    importImages,
    importSource,
    resolveSource,
    readonlyChanged,
    destroy() {
      disposed = true;
      readonlyChanged();
      loadRequests.forEach((request) => request.abort());
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
      resources.clear();
    },
  };
}
