import { computed, markRaw, onBeforeUnmount, ref, shallowRef } from 'vue';
import { isAxiosError } from 'axios';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import {
  COLLABORATION_SCHEMA_VERSION,
  getCollaborationTicket,
  type CollaborationTarget,
  type CollaborationUser,
} from '@/service/api/collaboration-api';
import type { DocumentPermissions } from '@/service/api/document-api';
import { errorMessage } from '@/utils/error';
import { randomUUID } from '@/utils/id';

export interface CollaborationBinding {
  document: Y.Doc;
  provider: HocuspocusProvider;
  epoch: number;
}
export interface PersistenceReceipt {
  epoch: number;
  revision: number;
  collab_seq: number;
}
type ConnectionState = 'idle' | 'connecting' | 'syncing' | 'ready' | 'offline' | 'blocked';
type PendingFlush = {
  version: number;
  resolve: (receipt: PersistenceReceipt) => void;
  reject: (cause: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const FLUSH_DELAY = 800;
const MAX_FLUSH_DELAY = 5000;
const REQUEST_TIMEOUT = 20000;

function base64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Connection-local presence is disposable. Keep the local clock/state and every Y.Doc type. */
function resetRemotePresence(provider: HocuspocusProvider, clientId: number) {
  const awareness = provider.awareness;
  if (!awareness) return;
  const states = awareness.getStates();
  // Hocuspocus removes remote states on close but retains their clocks. The new
  // server's same-clock snapshot must be accepted immediately after reconnect.
  for (const id of new Set([...states.keys(), ...awareness.meta.keys()])) {
    if (id === clientId) continue;
    states.delete(id);
    awareness.meta.delete(id);
  }
}

/** One owner for transport, persistence acknowledgement and recovery in every document route. */
export function useDocumentCollaboration(
  options: {
    onPersisted?: (receipt: PersistenceReceipt) => void;
    onPermissions?: (permissions: DocumentPermissions) => void;
    onReplaced?: () => void;
    onAttachmentsChanged?: () => void;
    onMetadataChanged?: () => void;
  } = {}
) {
  const binding = shallowRef<CollaborationBinding | null>(null);
  const managed = ref(false);
  const state = ref<ConnectionState>('idle');
  const error = ref('');
  const permissions = shallowRef<DocumentPermissions | null>(null);
  const users = shallowRef<CollaborationUser[]>([]);
  const pendingCount = ref(0);
  const localVersion = ref(0);
  const persistedVersion = ref(0);
  const synchronized = ref(false);
  const dirty = computed(() => localVersion.value > persistedVersion.value);
  const saving = computed(() => pendingCount.value > 0);
  const editable = computed(
    () =>
      managed.value &&
      state.value === 'ready' &&
      synchronized.value &&
      permissions.value?.write === true &&
      !error.value
  );
  const status = computed(() => {
    if (!managed.value) return '';
    if (error.value) return error.value;
    if (state.value === 'offline') return '连接已断开，正在重连；本地修改已保留';
    if (state.value === 'blocked') return '当前无法同步正文，请重新加载';
    return '';
  });
  const pending = new Map<string, PendingFlush>();
  let controller: AbortController | undefined;
  let generation = 0;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let firstPendingAt = 0;
  let activeFlush: Promise<PersistenceReceipt | undefined> | undefined;
  let latestReceipt: PersistenceReceipt | undefined;
  let terminal = false;
  let recoverableError = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reauthenticationTimer: ReturnType<typeof setTimeout> | undefined;

  function rejectPending(message: string) {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error(message));
    }
    pending.clear();
    pendingCount.value = 0;
  }

  function close() {
    generation++;
    controller?.abort();
    controller = undefined;
    clearTimeout(flushTimer);
    clearTimeout(reauthenticationTimer);
    reauthenticationTimer = undefined;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    flushTimer = undefined;
    firstPendingAt = 0;
    rejectPending('文档已切换，保存确认已取消');
    const previous = binding.value;
    binding.value = null;
    previous?.provider.destroy();
    previous?.document.destroy();
    activeFlush = undefined;
    latestReceipt = undefined;
    localVersion.value = 0;
    persistedVersion.value = 0;
    synchronized.value = false;
    state.value = 'idle';
    permissions.value = null;
    users.value = [];
    error.value = '';
    managed.value = false;
    terminal = false;
    recoverableError = false;
  }

  function scheduleFlush() {
    if (!dirty.value || terminal || state.value !== 'ready' || error.value) return;
    if (!firstPendingAt) firstPendingAt = Date.now();
    clearTimeout(flushTimer);
    const delay = Math.max(
      0,
      Math.min(FLUSH_DELAY, MAX_FLUSH_DELAY - (Date.now() - firstPendingAt))
    );
    flushTimer = setTimeout(() => {
      firstPendingAt = 0;
      void flush().catch(() => undefined);
    }, delay);
  }

  async function open(target: CollaborationTarget, signal?: AbortSignal) {
    close();
    const current = generation;
    const requestController = new AbortController();
    controller = requestController;
    const requestSignal = requestController.signal;
    const abort = () => requestController.abort();
    signal?.addEventListener('abort', abort, { once: true });
    managed.value = true;
    state.value = 'connecting';
    try {
      const ticket = await getCollaborationTicket(target, requestSignal);
      if (current !== generation || requestSignal.aborted) return;
      permissions.value = ticket.permissions;
      options.onPermissions?.(ticket.permissions);
      if (!ticket.enabled) throw new Error('协同服务暂不可用，正文已暂停编辑。请稍后重新加载。');
      if (!ticket.ticket || ticket.schema_version !== COLLABORATION_SCHEMA_VERSION)
        throw new Error('编辑器版本与服务器不兼容，请刷新页面后重试');
      const document = markRaw(new Y.Doc());
      let firstToken = ticket.ticket;
      let retryableAuthFailure = false;
      let reauthenticating = false;
      const clearReauthentication = () => {
        reauthenticating = false;
        clearTimeout(reauthenticationTimer);
        reauthenticationTimer = undefined;
      };
      let resolveInitial: () => void = () => undefined;
      let rejectInitial: (cause: Error) => void = () => undefined;
      const initiallySynced = new Promise<void>((resolve, reject) => {
        resolveInitial = resolve;
        rejectInitial = reject;
      });
      const isCurrent = () => current === generation && !requestSignal.aborted;
      const block = (message: string) => {
        if (!isCurrent()) return;
        clearReauthentication();
        terminal = true;
        synchronized.value = false;
        state.value = 'blocked';
        error.value = message;
        users.value = [];
        rejectPending(message);
        rejectInitial(new Error(message));
        queueMicrotask(() => {
          if (isCurrent()) binding.value?.provider.configuration.websocketProvider.disconnect();
        });
      };
      const url = new URL(ticket.ws_url || '/api/collab/ws', window.location.href);
      if (url.origin !== window.location.origin) throw new Error('协同服务地址无效，请联系管理员');
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const renewTicket = async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await getCollaborationTicket(target, requestSignal);
          } catch (cause) {
            const transient =
              isAxiosError(cause) &&
              (!cause.response || cause.response.status === 429 || cause.response.status >= 500);
            if (!transient || !isCurrent()) throw cause;
            state.value = 'offline';
            recoverableError = true;
            error.value = '协同服务暂不可用，正在重试；本地修改已保留。';
            if (attempt >= 4) {
              retryableAuthFailure = true;
              throw cause;
            }
            await new Promise<void>((resolve, reject) => {
              const cancel = () => {
                clearTimeout(timer);
                reject(new Error('文档已关闭'));
              };
              const timer = setTimeout(
                () => {
                  requestSignal.removeEventListener('abort', cancel);
                  resolve();
                },
                Math.min(3000, 250 * 2 ** attempt)
              );
              requestSignal.addEventListener('abort', cancel, { once: true });
            });
          }
        }
      };
      const provider = markRaw(
        new HocuspocusProvider({
          url: url.toString(),
          name: ticket.document_name,
          document,
          token: async () => {
            if (firstToken) {
              const token = firstToken;
              firstToken = '';
              return JSON.stringify({ ticket: token, client_id: document.clientID });
            }
            try {
              const next = await renewTicket();
              if (!isCurrent()) throw new Error('文档已切换');
              if (
                !next.enabled ||
                next.epoch !== ticket.epoch ||
                next.document_name !== ticket.document_name ||
                next.schema_version !== ticket.schema_version
              ) {
                block('文档版本已更新，本地修改已保留。请复制后重新加载。');
                if (!dirty.value) options.onReplaced?.();
                throw new Error('文档版本已更新');
              }
              const sameAnonymousReader =
                target.access === 'share' &&
                ticket.user.id.startsWith('guest-') &&
                next.user.id.startsWith('guest-') &&
                ticket.permissions.read &&
                next.permissions.read &&
                !ticket.permissions.write &&
                !next.permissions.write;
              if (next.user.id !== ticket.user.id && !sameAnonymousReader) {
                block('登录账号已改变，本地修改已保留。请复制后重新打开文档。');
                throw new Error('登录账号已改变');
              }
              ticket.user = next.user;
              ticket.permissions = next.permissions;
              permissions.value = next.permissions;
              options.onPermissions?.(next.permissions);
              return JSON.stringify({ ticket: next.ticket, client_id: document.clientID });
            } catch (cause) {
              if (isCurrent() && !retryableAuthFailure)
                block(errorMessage(cause, '重新授权失败，请重新登录后重试'));
              throw cause;
            }
          },
          onOpen: () => {
            if (!isCurrent() || terminal) return;
            clearReauthentication();
            // Reconnect cleanup can skip the previous close handler. Require this
            // socket's real handshake rather than retaining provider.isSynced.
            provider.synced = false;
            resetRemotePresence(provider, document.clientID);
            synchronized.value = false;
            state.value = 'syncing';
            rejectPending('连接正在重新建立，修改尚未确认保存');
          },
          onStatus: ({ status: next }) => {
            if (!isCurrent() || terminal) return;
            if (next !== 'connected') {
              clearReauthentication();
              synchronized.value = false;
              state.value = next === 'connecting' ? 'connecting' : 'offline';
              users.value = [];
              rejectPending('连接已断开，尚未确认保存；重连后将继续确认');
            } else state.value = 'syncing';
          },
          onSynced: ({ state: synced }) => {
            if (!isCurrent() || terminal) return;
            synchronized.value = synced;
            resumeAfterSync();
          },
          onAuthenticated: () => {
            if (!isCurrent() || terminal) return;
            clearReauthentication();
            // Never send presence from token(): authentication must reach the server first.
            provider.setAwarenessField('user', ticket.user);
            resumeAfterSync();
          },
          onAuthenticationFailed: ({ reason }) => {
            if (isCurrent()) clearReauthentication();
            if (
              isCurrent() &&
              !terminal &&
              ['authentication-expired', 'service-unavailable'].includes(reason)
            ) {
              // These machine reasons concern the collab service's temporary grant,
              // not the account session. A fresh ticket rechecks the account and ACL.
              retryableAuthFailure = true;
              recoverableError = true;
              error.value = '协同连接正在恢复，本地修改已保留。';
            }
            if (retryableAuthFailure && isCurrent() && !terminal) {
              retryableAuthFailure = false;
              synchronized.value = false;
              state.value = 'offline';
              rejectPending('协同服务暂不可用，修改尚未确认保存');
              provider.configuration.websocketProvider.disconnect();
              clearTimeout(reconnectTimer);
              reconnectTimer = setTimeout(() => {
                if (isCurrent() && !terminal)
                  void provider.configuration.websocketProvider.connect().catch(() => undefined);
              }, 5000);
              return;
            }
            block(
              dirty.value
                ? '协同访问已中断。本地修改已保留，请重新登录或重新加载。'
                : '协同连接未能完成，请重新加载或重新登录；如持续失败请联系管理员。'
            );
          },
          onAwarenessChange: ({ states }) => {
            if (!isCurrent() || terminal || state.value !== 'ready') return;
            const identities = new Map<string, CollaborationUser>();
            for (const item of states) {
              const user = item.user as CollaborationUser | undefined;
              if (user && typeof user.name === 'string' && typeof user.id === 'string')
                identities.set(user.id, {
                  id: user.id,
                  name: user.name.slice(0, 80),
                  color: user.color,
                  avator: typeof user.avator === 'string' ? user.avator : '',
                });
            }
            users.value = [...identities.values()];
          },
          onStateless: ({ payload }) => {
            if (!isCurrent()) return;
            let message: Record<string, unknown>;
            try {
              const parsed: unknown = JSON.parse(payload);
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
              message = parsed as Record<string, unknown>;
            } catch {
              return;
            }
            if (
              message.type === 'persisted' &&
              message.epoch === ticket.epoch &&
              typeof message.revision === 'number' &&
              typeof message.collab_seq === 'number'
            ) {
              const receipt = {
                epoch: ticket.epoch,
                revision: message.revision,
                collab_seq: message.collab_seq,
              };
              if (!latestReceipt || receipt.collab_seq >= latestReceipt.collab_seq) {
                latestReceipt = receipt;
                options.onPersisted?.(receipt);
              }
              // A state vector does not include deletion state. Only the ordered flush ACK
              // identifies all local updates (including deletes) sent before that request.
              const id = typeof message.request_id === 'string' ? message.request_id : '';
              const request = pending.get(id);
              if (request) {
                persistedVersion.value = Math.max(persistedVersion.value, request.version);
                clearTimeout(request.timeout);
                pending.delete(id);
                pendingCount.value = pending.size;
                error.value = '';
                recoverableError = false;
                request.resolve(receipt);
                scheduleFlush();
              } else if (recoverableError) {
                // A broadcast proves the service recovered, not that our edits are saved.
                // Resume through a new ordered flush; only its request_id ACK clears dirty.
                queueMicrotask(resumeAfterSync);
              }
            } else if (message.type === 'persistence-error') {
              if (message.retryable === false) {
                block('协同保存未被接受，本地修改已保留。请复制后重新加载。');
                return;
              }
              recoverableError = true;
              error.value = '保存尚未确认，本地修改已保留。请重试保存。';
              rejectPending(error.value);
            } else if (message.type === 'permission') {
              const next = message.permissions as DocumentPermissions | undefined;
              if (!next || typeof next.read !== 'boolean' || typeof next.write !== 'boolean')
                return;
              permissions.value = next;
              options.onPermissions?.(next);
              if (!next.read) {
                block('文档访问权限已失效，请联系文档管理员。');
                provider.configuration.websocketProvider.disconnect();
              }
            } else if (message.type === 'need-reauth') {
              // 续期也必须等待服务端鉴权成功；合并服务端重复请求，避免并发取票。
              if (terminal || reauthenticating) return;
              reauthenticating = true;
              // The existing grant remains valid while renewal is in flight.
              // Keep the editor stable until the server confirms or the socket fails.
              void provider
                .sendToken()
                .then(() => {
                  if (!isCurrent() || terminal || !reauthenticating) return;
                  // sendToken 只表示认证帧已发送，不表示服务端已接受续票。
                  // 计时从发送完成开始，避免与取票请求自身的网络重试相互干扰。
                  reauthenticationTimer = setTimeout(
                    reconnectAfterReauthentication,
                    REQUEST_TIMEOUT
                  );
                })
                .catch(reconnectAfterReauthentication);
            } else if (
              message.type === 'attachments-changed' ||
              (message.type === 'document-event' && message.kind === 'attachments')
            ) {
              options.onAttachmentsChanged?.();
            } else if (message.type === 'document-event' && message.kind === 'metadata') {
              options.onMetadataChanged?.();
            } else if (message.type === 'room-closed') {
              if (message.reason === 'authentication-expired') {
                // API restarts invalidate in-memory grants. Keep this Y.Doc and its pending
                // updates; a fresh ticket must still identify the same account and epoch.
                synchronized.value = false;
                state.value = 'connecting';
                error.value = '';
                users.value = [];
                rejectPending('授权正在重新验证，修改尚未确认保存');
                provider.configuration.websocketProvider.disconnect();
                clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(() => {
                  if (!isCurrent() || terminal) return;
                  void provider.configuration.websocketProvider.connect().catch(() => {
                    if (isCurrent() && !terminal) state.value = 'offline';
                  });
                }, 250);
                return;
              }
              const replace = message.reason === 'document-replaced';
              block(
                replace
                  ? '文档版本已更新，本地修改已保留。请复制后重新加载。'
                  : '文档访问已中断，本地修改已保留。请重新加载。'
              );
              provider.configuration.websocketProvider.disconnect();
              if (replace && !dirty.value) options.onReplaced?.();
            }
          },
        })
      );
      /** 续票已发出却没有收到确认时，保留当前 Y.Doc，通过完整握手恢复。 */
      function reconnectAfterReauthentication() {
        if (!isCurrent() || terminal) return;
        clearReauthentication();
        synchronized.value = false;
        state.value = 'offline';
        recoverableError = true;
        error.value = '协同授权确认超时，正在重新连接；本地修改已保留。';
        rejectPending(error.value);
        provider.configuration.websocketProvider.disconnect();
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          if (isCurrent() && !terminal)
            void provider.configuration.websocketProvider.connect().catch(() => undefined);
        }, 250);
      }

      function resumeAfterSync() {
        if (!isCurrent() || terminal || !synchronized.value || !provider.isAuthenticated) return;
        if (error.value && !recoverableError) return;
        state.value = 'ready';
        retryableAuthFailure = false;
        error.value = '';
        recoverableError = false;
        const identities = new Map<string, CollaborationUser>();
        for (const entry of provider.awareness?.getStates().values() ?? []) {
          const user = entry.user as CollaborationUser | undefined;
          if (user && typeof user.id === 'string' && typeof user.name === 'string')
            identities.set(user.id, { ...user, name: user.name.slice(0, 80) });
        }
        users.value = [...identities.values()];
        resolveInitial();
        scheduleFlush();
      }
      binding.value = markRaw({ document, provider, epoch: ticket.epoch });
      document.on(
        'update',
        (_update: Uint8Array, _origin: unknown, _doc: Y.Doc, transaction: Y.Transaction) => {
          if (!isCurrent() || !transaction.local || terminal) return;
          localVersion.value++;
          scheduleFlush();
        }
      );
      const timeout = setTimeout(() => {
        rejectInitial(new Error('协同连接超时，请重新加载'));
      }, REQUEST_TIMEOUT);
      const cancelInitial = () => rejectInitial(new Error('文档加载已取消'));
      requestSignal.addEventListener('abort', cancelInitial, { once: true });
      try {
        await initiallySynced;
        if (isCurrent()) await flush();
      } finally {
        clearTimeout(timeout);
        requestSignal.removeEventListener('abort', cancelInitial);
      }
    } catch (cause) {
      if (current === generation && !requestSignal.aborted) {
        error.value = errorMessage(cause, '协同服务连接失败，请重新加载');
        state.value = 'blocked';
        terminal = true;
        binding.value?.provider.configuration.websocketProvider.disconnect();
      }
      throw cause;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  async function flush(): Promise<PersistenceReceipt | undefined> {
    if (!managed.value) throw new Error('协同连接尚未建立，暂时无法确认保存');
    const current = generation;
    if (activeFlush) {
      const receipt = await activeFlush;
      if (current !== generation) throw new Error('文档已切换');
      return dirty.value ? flush() : receipt;
    }
    const session = binding.value;
    if (!session || terminal || state.value !== 'ready' || !synchronized.value)
      throw new Error(error.value || '协同连接尚未恢复，暂时无法确认保存');
    clearTimeout(flushTimer);
    firstPendingAt = 0;
    error.value = '';
    const requestId = randomUUID();
    const promise = new Promise<PersistenceReceipt>((resolve, reject) => {
      pending.set(requestId, {
        version: localVersion.value,
        resolve,
        reject,
        timeout: setTimeout(() => {
          pending.delete(requestId);
          pendingCount.value = pending.size;
          recoverableError = true;
          error.value = '保存确认超时，修改可能已保存。请重试确认，或复制本地内容。';
          reject(new Error(error.value));
        }, REQUEST_TIMEOUT),
      });
      pendingCount.value = pending.size;
      session.provider.sendStateless(
        JSON.stringify({
          type: 'flush',
          request_id: requestId,
          epoch: session.epoch,
          state_vector: base64(Y.encodeStateVector(session.document)),
        })
      );
    });
    activeFlush = promise;
    try {
      return await promise;
    } finally {
      if (current === generation) activeFlush = undefined;
    }
  }

  onBeforeUnmount(close);
  return {
    binding,
    managed,
    state,
    status,
    error,
    permissions,
    users,
    dirty,
    saving,
    editable,
    synchronized,
    open,
    close,
    flush,
  };
}
