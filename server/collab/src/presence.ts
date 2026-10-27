/** Awareness 只传播临时在线信息；客户端只能更新自己绑定的 clientID，用户身份由服务端覆盖。 */
import type { Connection } from '@hocuspocus/server';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { applyAwarenessUpdate } from 'y-protocols/awareness';
import { ServiceError } from './protocol.js';
import type { Context, Grant, Room } from './types.js';

export function applyPresence(room: Room, connection: Connection, bytes: Uint8Array, grant: Grant) {
  if (bytes.byteLength > 128 * 1024) throw new ServiceError('Awareness payload too large', 413);
  const decoder = decoding.createDecoder(bytes);
  const count = decoding.readVarUint(decoder);
  if (count > 256) throw new ServiceError('Too many awareness clients', 400);
  const localID = (connection.context as Context).clientId;
  const accepted: { client: number; clock: number; state: unknown }[] = [];
  for (let index = 0; index < count; index++) {
    const client = decoding.readVarUint(decoder);
    let clock = decoding.readVarUint(decoder);
    const value = JSON.parse(decoding.readVarString(decoder));
    // Hocuspocus 会转发缓存的远端状态，包括断开时排队的其他用户移除消息。
    // 这些缓存不能认领身份，也不能在重连后移除仍在线的其他用户。
    if (localID === null || client !== localID) continue;
    const previous = room.presenceOwners.get(client);
    if (previous && previous.connection !== connection) {
      const previousClosed = previous.connection.webSocket.readyState >= 2;
      if (previous.userId !== String(grant.user.id) && !previousClosed)
        throw new ServiceError('Awareness client ownership mismatch', 403);
      // 同账号重连时转移 clientID 的归属，旧连接清理不能移除新连接的状态。
      // 旧匿名连接已关闭时，新的匿名会话也可以重新认领该 ID。
      room.doc.getClients(previous.connection.webSocket).delete(client);
      if (!previousClosed)
        previous.connection.close({
          code: 4000,
          reason: 'presence-reconnected',
        });
      clock = Math.max(clock, (room.doc.awareness.meta.get(client)?.clock || 0) + 1);
    }
    room.presenceOwners.set(client, {
      userId: String(grant.user.id),
      connection,
    });
    let state = null;
    if (value !== null) {
      if (typeof value !== 'object' || Array.isArray(value))
        throw new ServiceError('Invalid awareness state', 400);
      const cursor = value.cursor && typeof value.cursor === 'object' ? value.cursor : undefined;
      const palette = ['#2563EB', '#7C3AED', '#059669', '#D97706', '#DB2777', '#0891B2'];
      const colorIndex =
        Array.from(String(grant.user.id)).reduce((sum, char) => sum + char.charCodeAt(0), 0) %
        palette.length;
      state = {
        cursor,
        user: {
          id: String(grant.user.id),
          name: String(grant.user.name).slice(0, 80),
          // 头像与昵称都来自 Go 已验证的授权，不接受客户端自行声明的用户资料。
          avator: typeof grant.user.avator === 'string' ? grant.user.avator : '',
          color: palette[colorIndex],
        },
      };
    }
    accepted.push({ client, clock, state });
  }
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, accepted.length);
  for (const item of accepted) {
    encoding.writeVarUint(encoder, item.client);
    encoding.writeVarUint(encoder, item.clock);
    encoding.writeVarString(encoder, JSON.stringify(item.state));
  }
  applyAwarenessUpdate(room.doc.awareness, encoding.toUint8Array(encoder), connection.webSocket);
  // 当前锁定版本的 Hocuspocus 3 将同一底层缓冲区传给 beforeHandleMessage
  // 和默认 MessageReceiver。校验后把原始条目数改为 0，
  // 防止默认接收器再次应用未受信任或已忽略的条目。
  // readVarUint8Array 返回子数组视图，因此不会改变长度和消息边界。
  bytes[0] = 0;
}
