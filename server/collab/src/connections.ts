import { Messages, SocketCloseCode, httpStatus, publicFailure } from "./errors.js";
/** 连接鉴权、续票、流量限制和定时权限复核；不负责正文合并。 */
import { STATUS_CODES, type IncomingMessage } from 'node:http';
import {
  OutgoingMessage,
  type Server,
  type ServerConfiguration,
  type Connection,
} from '@hocuspocus/server';
import * as decoding from 'lib0/decoding';
import { removeAwarenessStates } from 'y-protocols/awareness';
import type { RoomService } from './rooms.js';
import {
  authentication,
  checkSchema,
  key,
  receipt,
  ServiceError,
  type BackendClient,
} from './protocol.js';
import type { Context, Grant } from './types.js';

/** 升级请求只能来自页面自身：Origin 的 host:port 必须与 Host 完全一致。
 *  浏览器总是按实际访问地址填写这两个头，因此本机、局域网和反向代理都无需额外配置。 */
function sameHost(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.host.toLowerCase() === host.toLowerCase();
}

export function createConnectionHandlers(service: RoomService, go: BackendClient) {
  const { rooms, checks, authorize, discardRoom, expireConnectionAuthorization } = service;
  const renewals = new WeakMap<Connection, number>();
  const sockets = new WeakMap<
    object,
    {
      authenticated: boolean;
      bytes: number;
      messages: number;
      started: number;
      document?: string;
    }
  >();
  const hooks: Pick<
    ServerConfiguration,
    'onUpgrade' | 'onAuthenticate' | 'onTokenSync' | 'connected'
  > = {
    async onUpgrade({ request, socket }) {
      const url = new URL(request.url || '/', 'http://localhost');
      if (
        service.isDraining() ||
        url.pathname !== '/api/collab/ws' ||
        url.search ||
        !sameHost(request)
      ) {
        socket.write(`HTTP/1.1 ${httpStatus.HTTP_STATUS_FORBIDDEN} ${STATUS_CODES[httpStatus.HTTP_STATUS_FORBIDDEN]}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
        throw null;
      }
    },
    async onAuthenticate(data) {
      if (service.isDraining()) throw new ServiceError(Messages.ServiceUnavailable);
      const file_key = key(data.documentName);
      const auth = authentication(data.token);
      let grant: Grant;
      try {
        grant = await go<Grant>('authorize', { ticket: auth.ticket, file_key });
      } catch (error) {
        if (error instanceof ServiceError && error.status === httpStatus.HTTP_STATUS_UNAUTHORIZED)
          throw { code: SocketCloseCode.AuthenticationExpired, reason: 'authentication-expired' };
        if (error instanceof ServiceError && error.status >= httpStatus.HTTP_STATUS_INTERNAL_SERVER_ERROR)
          throw { code: SocketCloseCode.TryAgainLater, reason: 'service-unavailable' };
        throw error;
      }
      checkSchema(grant);
      if (!grant.permissions.read || grant.document_name !== data.documentName)
        throw new ServiceError(Messages.NoAccessPermission, httpStatus.HTTP_STATUS_FORBIDDEN);
      data.connectionConfig.readOnly = !grant.permissions.write;
      return { grant, clientId: auth.clientId } satisfies Context;
    },
    /** 续票必须迁移尚未保存改动的授权 ID；旧续票响应不得覆盖新响应。 */
    async onTokenSync(data) {
      const sequence = (renewals.get(data.connection) || 0) + 1;
      renewals.set(data.connection, sequence);
      const auth = authentication(data.token);
      let grant: Grant;
      try {
        grant = await go<Grant>('authorize', {
          ticket: auth.ticket,
          file_key: key(data.documentName),
        });
      } catch (error) {
        if (renewals.get(data.connection) !== sequence) return {};
        if (error instanceof ServiceError && error.status === httpStatus.HTTP_STATUS_UNAUTHORIZED) {
          expireConnectionAuthorization(data.connection);
          throw { code: SocketCloseCode.AuthenticationExpired, reason: 'authentication-expired' };
        }
        if (error instanceof ServiceError && error.status >= httpStatus.HTTP_STATUS_INTERNAL_SERVER_ERROR) {
          data.connection.sendStateless(
            JSON.stringify({
              type: 'persistence-error',
              message: publicFailure(error, "renew authorization").message,
              retryable: true,
            })
          );
          throw { code: SocketCloseCode.TryAgainLater, reason: 'service-unavailable' };
        }
        throw error;
      }
      if (renewals.get(data.connection) !== sequence) return {};
      checkSchema(grant);
      const room = rooms.get(data.documentName);
      if (!room || grant.epoch !== room.state.epoch)
        throw new ServiceError(Messages.DocumentChanged, httpStatus.HTTP_STATUS_CONFLICT);
      const previousGrant = (data.connection.context as Context).grant;
      const previous = previousGrant.authorization_id;
      if (room.actors.has(previous) && grant.user.id !== previousGrant.user.id)
        throw new ServiceError(Messages.ReconnectOriginalAccount, httpStatus.HTTP_STATUS_FORBIDDEN);
      const context = data.connection.context as Context;
      if (
        context.clientId !== null &&
        context.clientId !== auth.clientId &&
        room.presenceOwners.get(context.clientId)?.connection === data.connection
      ) {
        removeAwarenessStates(room.doc.awareness, [context.clientId], data.connection.webSocket);
        room.presenceOwners.delete(context.clientId);
      }
      context.grant = grant;
      context.clientId = auth.clientId;
      (data.context as Context).grant = grant;
      (data.context as Context).clientId = auth.clientId;
      data.connection.readOnly = !grant.permissions.write;
      data.connectionConfig.readOnly = !grant.permissions.write;
      if (room.actors.has(previous)) {
        const version = room.actors.get(previous)!;
        room.actors.delete(previous);
        room.actors.set(grant.authorization_id, version);
      }
      if (room.pendingCommit) {
        const pending = room.pendingCommit;
        const request = pending.request as {
          authorization_id: string;
          actors: string[];
        };
        request.actors = request.actors.map((id) =>
          id === previous ? grant.authorization_id : id
        );
        if (request.authorization_id === previous)
          request.authorization_id = grant.authorization_id;
        pending.actors = pending.actors.map((id) =>
          id === previous ? grant.authorization_id : id
        );
      }
      room.blocked = false;
      room.lastAuth = grant.authorization_id;
      checks.set(data.connection, Date.now());
      data.connection.sendStateless(
        JSON.stringify({ type: 'permission', permissions: grant.permissions })
      );
      // Hocuspocus 3 的 onTokenSync 不会自动确认续票。先完成授权迁移，
      // 再返回原生鉴权成功消息，让客户端退出续期等待并恢复原 Y.Doc 的编辑。
      data.connection.send(
        new OutgoingMessage(data.documentName)
          .writeAuthenticated(data.connection.readOnly)
          .toUint8Array()
      );
      return { grant, clientId: auth.clientId };
    },
    async connected({ connection }) {
      const info = sockets.get(connection.webSocket);
      if (info) info.authenticated = true;
      const room = rooms.get(connection.document.name);
      if (room) {
        connection.sendStateless(
          JSON.stringify({
            type: 'permission',
            permissions: (connection.context as Context).grant.permissions,
          })
        );
        connection.sendStateless(JSON.stringify(receipt(room)));
      }
    },
  };

  function attachSocketLimits(server: Server) {
    /** 在 Hocuspocus 排队前限制未鉴权流量；一个 WebSocket 只能绑定一篇文档。 */
    server.webSocketServer.prependListener('connection', (socket) => {
      const info = {
        authenticated: false,
        bytes: 0,
        messages: 0,
        started: Date.now(),
        document: undefined as string | undefined,
      };
      sockets.set(socket, info);
      const deadline = setTimeout(() => {
        if (!info.authenticated) socket.close(SocketCloseCode.AuthenticationExpired, 'authentication-timeout');
      }, 15000);
      deadline.unref();
      socket.once('close', () => clearTimeout(deadline));
      socket.prependListener('message', (raw: Buffer) => {
        if (Date.now() - info.started > 5000 && info.authenticated) {
          info.started = Date.now();
          info.bytes = 0;
          info.messages = 0;
        }
        info.bytes += raw.byteLength;
        info.messages++;
        try {
          const document = decoding.readVarString(decoding.createDecoder(new Uint8Array(raw)));
          if (info.document && info.document !== document) throw new Error('one document');
          info.document = document;
          if (
            info.bytes > (info.authenticated ? 64 : 24) * 1024 * 1024 ||
            info.messages > (info.authenticated ? 2000 : 50)
          )
            throw new Error('rate');
        } catch {
          socket.terminate();
        }
      });
    });
  }

  /** 过期前请求客户端续票；临时后端故障允许重新连接，权限变化则关闭对应连接。 */
  function startRevalidation() {
    const revalidate = setInterval(() => {
      for (const room of rooms.values())
        for (const connection of room.doc.getConnections()) {
          const grant = (connection.context as Context).grant;
          if (Date.parse(grant.expires_at) - Date.now() < 120000)
            connection.sendStateless(JSON.stringify({ type: 'need-reauth' }));
          void authorize(connection, true).catch((error) => {
            if ((connection.context as Context).grant.authorization_id !== grant.authorization_id)
              return;
            if (error instanceof ServiceError && error.status >= httpStatus.HTTP_STATUS_INTERNAL_SERVER_ERROR) {
              connection.readOnly = true;
              checks.delete(connection);
              connection.sendStateless(
                JSON.stringify({
                  type: 'persistence-error',
                  message: publicFailure(error, "renew authorization").message,
                  retryable: true,
                })
              );
              connection.close({ code: SocketCloseCode.TryAgainLater, reason: 'service-unavailable' });
              return;
            }
            connection.sendStateless(
              JSON.stringify({
                type: 'room-closed',
                reason:
                  error instanceof ServiceError && error.status === httpStatus.HTTP_STATUS_UNAUTHORIZED
                    ? 'authentication-expired'
                    : 'permission-changed',
                epoch: room.state.epoch,
              })
            );
            if (room.actors.has(grant.authorization_id))
              discardRoom(room, 'authentication-expired');
            else connection.close({ code: SocketCloseCode.AuthenticationExpired, reason: 'authorization-expired' });
          });
        }
    }, 5000);
    revalidate.unref();
    return () => clearInterval(revalidate);
  }
  return { hooks, attachSocketLimits, startRevalidation };
}
