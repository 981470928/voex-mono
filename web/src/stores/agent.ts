import { computed, onScopeDispose, reactive, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { authUser } from '@/service/auth-session';
import {
  beginAITurn,
  createAIConversation,
  deleteAIConversation,
  finishAITurn,
  getAIConversation,
  listAIConversations,
} from '@/service/api/ai-api';
import { errorMessage } from '@/utils/error';
import { randomUUID } from '@/utils/id';
import type { AIConversationSession, ChatMessage, TurnResponseInput } from '@/agent/types';

interface HistoryState {
  loaded: boolean;
  loading: boolean;
  error: string;
  nextCursor: string;
}
interface ConversationListState extends HistoryState {
  creating: boolean;
  createError: string;
}

// Account-scoped caches; every message, draft and pending write belongs to one conversation.
export const useAgentStore = defineStore('agent', () => {
  const sessions = reactive<Record<string, ChatMessage[]>>({});
  const states = reactive<Record<string, HistoryState>>({});
  const conversations = reactive<Record<string, AIConversationSession[]>>({});
  const selectedSessions = reactive<Record<string, string>>({});
  const lists = reactive<Record<string, ConversationListState>>({});
  const drafts = reactive<Record<string, string>>({});
  const reads = new Map<string, AbortController>();
  const writes = new Set<AbortController>();
  const versions = new Map<string, number>();
  const pendingCreates = new Map<string, string>();
  const creates = new Map<string, Promise<AIConversationSession>>();
  const pending = new Map<
    string,
    { fileKey: string; sessionId: string; input: TurnResponseInput }
  >();
  const inFlight = new Map<string, Promise<ChatMessage[]>>();
  const pendingCount = ref(0);
  const hasUnpersisted = computed(() => pendingCount.value > 0);
  let epoch = 0;

  function cacheKey(fileKey: string, sessionId: string) {
    return JSON.stringify([fileKey, sessionId]);
  }
  function messages(fileKey: string, sessionId: string): ChatMessage[] {
    return sessions[cacheKey(fileKey, sessionId)] ?? [];
  }
  function draft(fileKey: string, sessionId: string) {
    return drafts[cacheKey(fileKey, sessionId)] ?? '';
  }
  function setDraft(fileKey: string, sessionId: string, value: string) {
    drafts[cacheKey(fileKey, sessionId)] = value;
  }
  function state(fileKey: string, sessionId: string): HistoryState {
    const key = cacheKey(fileKey, sessionId);
    if (!states[key]) states[key] = { loaded: false, loading: false, error: '', nextCursor: '' };
    return states[key]!;
  }
  function listState(fileKey: string): ConversationListState {
    if (!lists[fileKey])
      lists[fileKey] = {
        loaded: false,
        loading: false,
        error: '',
        nextCursor: '',
        creating: false,
        createError: '',
      };
    return lists[fileKey]!;
  }
  function activateConversation(fileKey: string, id: string) {
    if (!selectedSessions[fileKey] && id) {
      const staging = cacheKey(fileKey, '');
      const target = cacheKey(fileKey, id);
      if (drafts[staging] && !drafts[target]) {
        drafts[target] = drafts[staging];
        delete drafts[staging];
      }
    }
    selectedSessions[fileKey] = id;
  }
  function selectConversation(fileKey: string, id: string) {
    if (conversations[fileKey]?.some((session) => session.id === id))
      activateConversation(fileKey, id);
  }
  function mergeConversations(fileKey: string, incoming: AIConversationSession[], prepend = false) {
    if (!conversations[fileKey]) conversations[fileKey] = [];
    const items = conversations[fileKey]!;
    for (const session of incoming) {
      const existing = items.find((item) => item.id === session.id);
      if (existing) {
        if (session.updatedAt >= existing.updatedAt) Object.assign(existing, session);
      } else if (prepend) items.unshift(session);
      else items.push(session);
    }
    // Creation time is stable while replies update updatedAt; retain loaded older pages.
    items.sort((a, b) => b.createdAt - a.createdAt);
  }
  async function loadConversations(fileKey: string, older = false) {
    if (!fileKey || !authUser.value) return;
    const current = epoch;
    const key = `list:${fileKey}`;
    const info = listState(fileKey);
    const version = versions.get(key) ?? 0;
    if (older && (!info.nextCursor || info.loading)) return;
    reads.get(key)?.abort();
    const controller = new AbortController();
    reads.set(key, controller);
    info.loading = true;
    info.error = '';
    try {
      const page = await listAIConversations(
        fileKey,
        older ? info.nextCursor : '',
        controller.signal
      );
      if (epoch !== current || controller.signal.aborted || (versions.get(key) ?? 0) !== version)
        return;
      mergeConversations(fileKey, page.sessions);
      info.nextCursor = page.nextCursor;
      info.loaded = true;
      if (!selectedSessions[fileKey])
        activateConversation(fileKey, conversations[fileKey]?.[0]?.id ?? '');
    } catch (cause) {
      if (epoch === current && !controller.signal.aborted)
        info.error = errorMessage(cause, '对话列表加载失败，请重试');
    } finally {
      if (reads.get(key) === controller) {
        reads.delete(key);
        info.loading = false;
      }
    }
  }
  function createConversation(fileKey: string): Promise<AIConversationSession> {
    const existing = creates.get(fileKey);
    if (existing) return existing;
    if (!fileKey || !authUser.value) return Promise.reject(new Error('请先登录并打开文档'));
    const current = epoch;
    const id = pendingCreates.get(fileKey) ?? randomUUID();
    pendingCreates.set(fileKey, id);
    const info = listState(fileKey);
    const controller = new AbortController();
    writes.add(controller);
    info.creating = true;
    info.createError = '';
    const request = createAIConversation(fileKey, id, controller.signal)
      .then(async (session) => {
        if (epoch !== current) throw new Error('账号已切换');
        pendingCreates.delete(fileKey);
        mergeConversations(fileKey, [session], true);
        activateConversation(fileKey, session.id);
        // An idempotent replay can already contain turns from another tab.
        await load(fileKey, session.id);
        if (epoch !== current) throw new Error('账号已切换');
        return session;
      })
      .catch((cause: unknown) => {
        if (epoch === current) info.createError = errorMessage(cause, '新建对话失败，请重试');
        throw cause;
      })
      .finally(() => {
        writes.delete(controller);
        if (creates.get(fileKey) === request) {
          creates.delete(fileKey);
          info.creating = false;
        }
      });
    creates.set(fileKey, request);
    return request;
  }

  async function removeConversation(fileKey: string, id: string) {
    if (!fileKey || !authUser.value) throw new Error('请先登录并打开文档');
    if (
      messages(fileKey, id).some((message) => !!message.persistence) ||
      [...pending.values()].some((entry) => entry.fileKey === fileKey && entry.sessionId === id)
    )
      throw new Error('此对话有未保存的回复，请先重试保存后再删除');
    const current = epoch;
    const controller = new AbortController();
    writes.add(controller);
    try {
      await deleteAIConversation(fileKey, id, controller.signal);
      if (epoch !== current) throw new Error('账号已切换');
      const key = cacheKey(fileKey, id);
      changed(key);
      changed(`list:${fileKey}`);
      reads.get(key)?.abort();
      delete sessions[key];
      delete states[key];
      delete drafts[key];
      conversations[fileKey] = (conversations[fileKey] ?? []).filter(
        (session) => session.id !== id
      );
      if (selectedSessions[fileKey] === id)
        selectedSessions[fileKey] = conversations[fileKey]?.[0]?.id ?? '';
    } finally {
      writes.delete(controller);
    }
  }

  function merge(key: string, incoming: ChatMessage[], completedTurn?: string) {
    if (!sessions[key]) sessions[key] = [];
    const session = sessions[key]!;
    for (const message of incoming) {
      const existing = session.find((item) => item.id === message.id);
      if (existing && existing.persistence && message.turnId !== completedTurn) continue;
      if (
        existing?.review?.id === message.review?.id &&
        existing?.review?.status === 'applied' &&
        message.review
      )
        message.review.status = 'applied';
      if (existing) {
        Object.assign(existing, message);
        if (message.turnId === completedTurn) {
          delete existing.persistence;
          delete existing.persistenceError;
        }
      } else session.push(message);
    }
    session.sort(
      (a, b) => a.sequence - b.sequence || (a.role === b.role ? 0 : a.role === 'user' ? -1 : 1)
    );
  }
  function changed(key: string) {
    versions.set(key, (versions.get(key) ?? 0) + 1);
  }
  async function load(fileKey: string, sessionId: string, older = false) {
    if (!fileKey || !sessionId || !authUser.value) return;
    const key = cacheKey(fileKey, sessionId);
    const current = epoch;
    const version = versions.get(key) ?? 0;
    const info = state(fileKey, sessionId);
    if (older && (!info.nextCursor || info.loading)) return;
    reads.get(key)?.abort();
    const controller = new AbortController();
    reads.set(key, controller);
    info.loading = true;
    info.error = '';
    try {
      const page = await getAIConversation(
        fileKey,
        sessionId,
        older ? info.nextCursor : '',
        controller.signal
      );
      if (epoch !== current || controller.signal.aborted || (versions.get(key) ?? 0) !== version)
        return;
      // Keep message objects until merging so a late read cannot downgrade applied status.
      merge(key, page.messages);
      info.nextCursor = page.nextCursor;
      info.loaded = true;
    } catch (cause) {
      if (epoch === current && !controller.signal.aborted)
        info.error = errorMessage(cause, '对话历史加载失败，请重试');
    } finally {
      if (reads.get(key) === controller) {
        reads.delete(key);
        info.loading = false;
      }
    }
  }
  async function begin(
    fileKey: string,
    sessionId: string,
    modelId: string,
    prompt: string,
    signal: AbortSignal
  ) {
    const key = cacheKey(fileKey, sessionId);
    const current = epoch;
    const id = randomUUID();
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    writes.add(controller);
    try {
      const result = await beginAITurn(fileKey, sessionId, id, modelId, prompt, controller.signal);
      if (current !== epoch) throw new Error('账号已切换');
      changed(key);
      const firstTurn = !messages(fileKey, sessionId).some((message) => message.role === 'user');
      merge(key, result);
      const session = conversations[fileKey]?.find((item) => item.id === sessionId);
      if (session) {
        if (firstTurn && session.title === '新对话')
          session.title = Array.from(prompt.trim().replace(/\s+/g, ' ')).slice(0, 40).join('');
        session.updatedAt = result[0]?.createdAt ?? session.updatedAt;
      }
      const message = sessions[key]!.find((item) => item.id === id)!;
      message.persistence = 'saving';
      return message;
    } finally {
      writes.delete(controller);
      signal.removeEventListener('abort', stop);
    }
  }
  function save(fileKey: string, sessionId: string, id: string, input: TurnResponseInput) {
    // Retries retain the original conversation and immutable finalized payload.
    if (!pending.has(id))
      pending.set(id, {
        fileKey,
        sessionId,
        input: JSON.parse(JSON.stringify(input)) as TurnResponseInput,
      });
    pendingCount.value = pending.size;
    return retry(id);
  }
  function retry(id: string): Promise<ChatMessage[]> {
    const existing = inFlight.get(id);
    if (existing) return existing;
    const entry = pending.get(id);
    if (!entry) return Promise.reject(new Error('没有待重试的对话'));
    const key = cacheKey(entry.fileKey, entry.sessionId);
    const current = epoch;
    const controller = new AbortController();
    writes.add(controller);
    const message = sessions[key]?.find((item) => item.id === id);
    if (message) {
      message.persistence = 'saving';
      message.persistenceError = '';
    }
    const request = finishAITurn(entry.fileKey, id, entry.input, controller.signal)
      .then((result) => {
        if (epoch !== current) throw new Error('账号已切换');
        pending.delete(id);
        pendingCount.value = pending.size;
        changed(key);
        merge(key, result, id);
        return result;
      })
      .catch((cause: unknown) => {
        if (epoch === current && message) {
          message.persistence = 'failed';
          message.persistenceError = errorMessage(
            cause,
            '回复尚未保存，请重试；刷新会丢失这份回复'
          );
        }
        throw cause;
      })
      .finally(() => {
        writes.delete(controller);
        if (inFlight.get(id) === request) inFlight.delete(id);
      });
    inFlight.set(id, request);
    return request;
  }
  function markApplied(id: string) {
    for (const [key, items] of Object.entries(sessions))
      for (const message of items)
        if (message.review?.id === id) {
          message.review.status = 'applied';
          changed(key);
        }
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!hasUnpersisted.value && !writes.size) return;
    event.preventDefault();
    event.returnValue = '';
  }
  window.addEventListener('beforeunload', beforeUnload);
  onScopeDispose(() => window.removeEventListener('beforeunload', beforeUnload));
  watch(
    () => authUser.value?.id,
    () => {
      epoch++;
      reads.forEach((controller) => controller.abort());
      writes.forEach((controller) => controller.abort());
      reads.clear();
      versions.clear();
      writes.clear();
      pendingCreates.clear();
      creates.clear();
      pending.clear();
      inFlight.clear();
      pendingCount.value = 0;
      for (const record of [sessions, states, conversations, selectedSessions, lists, drafts])
        for (const key of Object.keys(record)) delete record[key];
    },
    { flush: 'sync' }
  );
  return {
    conversations,
    selectedSessions,
    messages,
    draft,
    setDraft,
    state,
    listState,
    loadConversations,
    createConversation,
    removeConversation,
    selectConversation,
    load,
    begin,
    save,
    retry,
    markApplied,
    hasUnpersisted,
  };
});
