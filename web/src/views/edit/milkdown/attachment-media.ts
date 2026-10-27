import type { FileInfo } from '@/service/api/document-api';
import { attachmentMediaKind } from '@voex/editor-schema/attachment';
export { attachmentMediaKind } from '@voex/editor-schema/attachment';

export type MediaAttachment = Pick<FileInfo, 'hash' | 'name' | 'mime'>;
export interface AttachmentMediaOptions {
  loadFile: (hash: string, signal: AbortSignal) => Promise<Blob>;
  readonly: () => boolean;
  onStateChange?: () => void;
}

/** Playback reuses the authorized attachment reader; temporary URLs never enter the document. */
export function createAttachmentMedia(options: AttachmentMediaOptions) {
  const dom = document.createElement('div');
  dom.className = 'milkdown-attachment__media';
  dom.contentEditable = 'false';
  const status = document.createElement('span');
  status.className = 'milkdown-attachment__media-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const load = document.createElement('button');
  load.type = 'button';
  load.className = 'milkdown-attachment__preview';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'milkdown-attachment__preview';
  cancel.textContent = '取消加载';
  cancel.hidden = true;
  dom.append(status, load, cancel);

  let file: MediaAttachment = { hash: '', name: '', mime: '' };
  let player: HTMLMediaElement | null = null;
  let request: AbortController | null = null;
  let objectUrl: string | null = null;
  let available = false;
  let disposed = false;
  let generation = 0;
  let identity = '';
  let label = '媒体';

  function release() {
    generation++;
    request?.abort();
    request = null;
    if (player) {
      player.onerror = player.onloadedmetadata = null;
      player.pause();
      player.removeAttribute('src');
      player.load();
      player.remove();
      player = null;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    dom.removeAttribute('aria-busy');
    cancel.hidden = true;
  }

  function idle(message = `点击加载${label}后播放`, retry = false) {
    status.textContent = message;
    status.hidden = false;
    load.textContent = retry ? '重新加载' : `加载${label}`;
    load.setAttribute('aria-label', `${load.textContent} ${file.name || '未命名附件'}`);
    load.hidden = !available;
    load.disabled = false;
  }

  function failed(message: string) {
    const restoreFocus = dom.contains(document.activeElement);
    release();
    idle(message, true);
    if (restoreFocus) load.focus();
  }

  async function start() {
    const kind = attachmentMediaKind(file.mime);
    if (disposed || !available || request || player || !kind) return;
    const current = ++generation;
    const attachment = { ...file };
    const pending = new AbortController();
    request = pending;
    const restoreFocus = document.activeElement === load;
    load.disabled = true;
    load.hidden = true;
    cancel.hidden = false;
    dom.setAttribute('aria-busy', 'true');
    status.textContent = `正在加载${label}…`;
    if (restoreFocus) cancel.focus();
    try {
      const blob = await options.loadFile(attachment.hash, pending.signal);
      if (disposed || current !== generation || pending.signal.aborted) return;
      if (!blob.size) throw new Error('empty media');
      const mime = blob.type.toLowerCase().split(';')[0]!;
      if (mime && mime !== 'application/octet-stream' && !mime.startsWith(`${kind}/`))
        throw new Error('unexpected media type');
      const source = mime.startsWith(`${kind}/`) ? blob : blob.slice(0, blob.size, attachment.mime);
      objectUrl = URL.createObjectURL(source);
      const element = document.createElement(kind);
      player = element;
      element.className = 'milkdown-attachment__player';
      element.controls = true;
      element.tabIndex = 0;
      element.preload = 'metadata';
      element.setAttribute('aria-label', `${label} ${file.name || '未命名附件'}`);
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      element.onloadedmetadata = () => {
        if (disposed || current !== generation) return;
        status.hidden = true;
        dom.removeAttribute('aria-busy');
        options.onStateChange?.();
      };
      element.onerror = () => {
        if (disposed || current !== generation) return;
        failed(`${label}无法播放，请重新加载或通过预览查看附件（浏览器可能不支持此编码）`);
      };
      element.src = objectUrl;
      dom.prepend(element);
      const restoreFocus = dom.contains(document.activeElement);
      load.hidden = cancel.hidden = true;
      if (restoreFocus) element.focus();
      status.textContent = `正在读取${label}…`;
    } catch {
      if (!disposed && current === generation && !pending.signal.aborted)
        failed(`${label}加载失败，请检查网络和访问权限后重试`);
    } finally {
      if (request === pending) request = null;
    }
  }

  load.onclick = () => void start();
  cancel.onclick = () => {
    release();
    idle();
    load.focus();
  };

  return {
    dom,
    getPlayer: () => player,
    update(next: MediaAttachment, isAvailable: boolean) {
      if (disposed) return;
      const kind = attachmentMediaKind(next.mime);
      const nextIdentity = JSON.stringify([next.hash, next.mime, isAvailable]);
      file = next;
      available = isAvailable;
      label = kind === 'video' ? '视频' : '音频';
      dom.hidden = !kind;
      if (identity !== nextIdentity) {
        identity = nextIdentity;
        release();
        idle(isAvailable ? undefined : `${label}附件不可用`);
        if (kind && isAvailable) void start();
      }
      player?.setAttribute('aria-label', `${label} ${file.name || '未命名附件'}`);
      load.setAttribute('aria-label', `${load.textContent} ${file.name || '未命名附件'}`);
    },
    destroy() {
      disposed = true;
      release();
      load.onclick = cancel.onclick = null;
    },
  };
}
