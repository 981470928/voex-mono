import { defineStore } from 'pinia';
import { onScopeDispose, ref } from 'vue';
import { errorMessage } from '@/utils/error';

export type NotificationTone = 'success' | 'error' | 'info' | 'loading';
export interface NotificationAction {
  label: string;
  run: () => void | Promise<void>;
}
export interface NotificationMessage {
  id: number;
  message: string;
  tone: NotificationTone;
  action?: NotificationAction;
}

export const useNotificationStore = defineStore('notification', () => {
  const message = ref('');
  const tone = ref<'success' | 'error' | 'info'>('info');
  const notices = ref<NotificationMessage[]>([]);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextId = 0;
  let legacyId: number | undefined;

  function dismiss(id = legacyId) {
    if (id === undefined) return;
    clearTimeout(timers.get(id));
    timers.delete(id);
    notices.value = notices.value.filter((item) => item.id !== id);
    if (id === legacyId) {
      legacyId = undefined;
      message.value = '';
    }
  }
  function setDuration(id: number, duration: number) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    if (duration > 0)
      timers.set(
        id,
        setTimeout(() => dismiss(id), duration)
      );
  }
  function push(text: string, kind: NotificationTone, duration = 0, action?: NotificationAction) {
    const id = ++nextId;
    notices.value.push({ id, message: text, tone: kind, action });
    setDuration(id, duration);
    return id;
  }
  function update(id: number, text: string, kind?: NotificationTone, action?: NotificationAction) {
    const item = notices.value.find((item) => item.id === id);
    if (!item) return;
    item.message = text;
    if (kind) {
      item.tone = kind;
      item.action = action;
      setDuration(id, 0);
    }
  }
  async function runAction(id: number) {
    const item = notices.value.find((item) => item.id === id);
    if (!item?.action) return;
    const action = item.action;
    // Remove before invoking: a retry may create a replacement with the same key.
    dismiss(id);
    try {
      await action.run();
    } catch (cause) {
      push(errorMessage(cause, '操作失败，请重试'), 'error', 0, action);
    }
  }
  function show(text: string, kind: typeof tone.value = 'info', duration = 5000) {
    dismiss();
    message.value = text;
    tone.value = kind;
    legacyId = push(text, kind, duration);
  }
  onScopeDispose(() => {
    timers.forEach(clearTimeout);
    timers.clear();
  });
  return { message, tone, notices, show, dismiss, push, update, runAction };
});
