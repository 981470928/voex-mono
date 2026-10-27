import { onScopeDispose } from 'vue';
import { useNotificationStore, type NotificationTone } from '@/stores/notification';

interface MessageOptions {
  key?: string;
}
interface ErrorOptions extends MessageOptions {
  retry?: () => void | Promise<void>;
  actionLabel?: string;
}
export interface MessageHandle {
  update: (text: string) => void;
  close: () => void;
  error: (text: string, options?: ErrorOptions) => void;
}

/** Each caller owns its messages; stale handles never reopen or close a replacement. */
export function useMessageBox() {
  const store = useNotificationStore();
  const owned = new Set<number>();
  const keyed = new Map<string, number>();
  let disposed = false;

  function close(id: number) {
    store.dismiss(id);
    owned.delete(id);
    for (const [key, value] of keyed) if (value === id) keyed.delete(key);
  }
  function clear(key?: string) {
    if (key !== undefined) {
      const id = keyed.get(key);
      if (id !== undefined) close(id);
      return;
    }
    for (const id of [...owned]) close(id);
  }
  function action(options: ErrorOptions) {
    return options.retry ? { label: options.actionLabel ?? '重试', run: options.retry } : undefined;
  }
  function create(text: string, kind: NotificationTone, options: ErrorOptions = {}): MessageHandle {
    for (const id of owned) if (!store.notices.some((item) => item.id === id)) close(id);
    if (options.key !== undefined) clear(options.key);
    const id = disposed ? -1 : store.push(text, kind, kind === 'info' ? 5000 : 0, action(options));
    if (!disposed) {
      owned.add(id);
      if (options.key !== undefined) keyed.set(options.key, id);
    }
    return {
      update: (text) => store.update(id, text),
      close: () => close(id),
      error: (text, options = {}) => store.update(id, text, 'error', action(options)),
    };
  }
  onScopeDispose(() => {
    disposed = true;
    clear();
  });
  return {
    loading: (text: string, options?: MessageOptions) => create(text, 'loading', options),
    error: (text: string, options?: ErrorOptions) => create(text, 'error', options),
    info: (text: string, options?: MessageOptions) => create(text, 'info', options),
    clear,
  };
}
