/** 内部 HTTP 控制面：健康检查、AI 审阅、outbox 通知和排空。非健康接口必须校验共享密钥。 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerConfiguration } from '@hocuspocus/server';
import { SCHEMA_VERSION } from '@voex/editor-schema';
import { VERSION, type CollaborationConfig } from './config.js';
import type { RoomService } from './rooms.js';
import type { ReviewService } from './review.js';
import { announce, ServiceError, type BackendClient } from './protocol.js';
import type { Room, Context, Stored } from './types.js';

export function createHttpHandler(
  config: CollaborationConfig,
  service: RoomService,
  review: ReviewService,
  go: BackendClient
): NonNullable<ServerConfiguration['onRequest']> {
  const { secret } = config;
  const { rooms, authorize, discardRoom, reload, drain } = service;
  const { stages, prepare, finalize, abort } = review;
  /** 消费 Go outbox；事件可能重复或延迟，删除通知必须重新读取当前权限和文档状态。 */
  async function events(body: any) {
    if (!Array.isArray(body.events) || body.events.length > 1000)
      throw new ServiceError('Invalid events', 400);
    for (const event of body.events) {
      const targets = event.file_key
        ? ([rooms.get(event.file_key)].filter(Boolean) as Room[])
        : [...rooms.values()];
      for (const room of targets) {
        if (event.kind === 'deleted') {
          // Outbox 至少投递一次；文档、文件夹或项目事件都可能延迟到达，
          // 描述的是过去的变化，被恢复的文档此时可能已重新可访问。
          const authorizations = [
            ...new Set([
              ...room.doc
                .getConnections()
                .map((connection) => (connection.context as Context).grant.authorization_id),
              room.lastAuth,
            ]),
          ];
          let accessible = false;
          let lastFailure: unknown;
          for (const authorization_id of authorizations) {
            try {
              const latest = await go<Stored>('load', {
                file_key: room.state.file_key,
                authorization_id,
              });
              room.lastAuth = authorization_id;
              if (latest.epoch !== room.state.epoch)
                discardRoom(room, 'document-replaced', latest.epoch);
              accessible = true;
              break;
            } catch (error) {
              lastFailure = error;
              if (!(error instanceof ServiceError) || error.status >= 500) throw error;
            }
          }
          if (!accessible) {
            discardRoom(
              room,
              lastFailure instanceof ServiceError && lastFailure.status === 404
                ? 'document-deleted'
                : 'permission-changed'
            );
            continue;
          }
          if (room.invalid) continue;
        }
        if (event.kind === 'document' && room.prepared) {
          await reload(room);
          for (const [id, stage] of stages)
            if (stage.rooms.some((entry) => entry.room === room)) {
              clearTimeout(stage.timer);
              stages.delete(id);
            }
          continue;
        }
        if (event.kind === 'metadata' || event.kind === 'attachments')
          announce(room, { type: 'document-event', kind: event.kind });
        for (const connection of room.doc.getConnections()) {
          try {
            await authorize(connection, true);
          } catch {
            connection.sendStateless(
              JSON.stringify({
                type: 'room-closed',
                reason: 'permission-changed',
                epoch: room.state.epoch,
              })
            );
            connection.close({ code: 4003, reason: 'permission-changed' });
          }
        }
        if (event.kind === 'document') await reload(room);
      }
    }
    return { success: true };
  }
  function authorized(request: IncomingMessage) {
    const incoming = Buffer.from(String(request.headers['x-collab-secret'] || ''));
    const expected = Buffer.from(secret);
    return incoming.length === expected.length && timingSafeEqual(incoming, expected);
  }
  async function body(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 26 * 1024 * 1024) throw new ServiceError('Request too large', 413);
      chunks.push(Buffer.from(chunk));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw new ServiceError('Invalid JSON', 400);
    }
  }
  function json(response: ServerResponse, status: number, data: object) {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(data));
  }
  return async ({ request, response }) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      if (url.pathname === '/health/live' || url.pathname === '/health/ready') {
        json(response, url.pathname.endsWith('ready') && service.isDraining() ? 503 : 200, {
          success: true,
          version: VERSION,
          schema_version: SCHEMA_VERSION,
          draining: service.isDraining(),
          rooms: rooms.size,
        });
      } else if (request.method !== 'POST' || !authorized(request))
        json(response, 403, { message: 'Forbidden' });
      else {
        const payload = await body(request);
        const path = url.pathname;
        const result =
          path === '/internal/collab/prepare'
            ? await prepare(payload)
            : path === '/internal/collab/commit'
              ? await finalize(payload)
              : path === '/internal/collab/abort'
                ? await abort(payload)
                : path === '/internal/collab/events'
                  ? await events(payload)
                  : path === '/internal/collab/drain'
                    ? await drain()
                    : (() => {
                        throw new ServiceError('Not found', 404);
                      })();
        json(response, 200, result);
      }
    } catch (error) {
      json(response, error instanceof ServiceError ? error.status : 500, {
        message: error instanceof Error ? error.message : 'Internal error',
      });
    }
    throw null;
  };
}
