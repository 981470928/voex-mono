/**
 * 协同进程入口：只负责依赖组装、监听和停机。
 * 数据流：connections 鉴权 → sync 校验更新 → rooms / persistence 经 Go 保存。
 * 控制流：http 接收 Go 指令 → review 准备、确认或中止 AI 审阅。
 */
import { Server } from '@hocuspocus/server';
import { SCHEMA_VERSION } from '@voex/editor-schema';
import { loadConfig, MAX_MESSAGE, VERSION } from './config.js';
import { createBackendClient } from './protocol.js';
import { createDocumentCodec } from './documents.js';
import { createRoomService } from './rooms.js';
import { createReviewService } from './review.js';
import { createConnectionHandlers } from './connections.js';
import { createDocumentHooks } from './sync.js';
import { createHttpHandler } from './http.js';

const config = loadConfig();
const { host, port } = config;
const documents = await createDocumentCodec();
const go = createBackendClient(config);
// hooks 运行时 Server 已创建；延迟读取避免业务模块反向导入入口形成循环依赖。
let server: Server;
const getHocuspocus = () => server.hocuspocus;
const rooms = createRoomService(go, documents, getHocuspocus);
const review = createReviewService(rooms, go, documents, getHocuspocus);
const connections = createConnectionHandlers(rooms, go, config);
server = new Server(
  {
    name: 'voex-collab',
    address: host,
    port,
    quiet: true,
    stopOnSignals: false,
    debounce: 1000,
    maxDebounce: 5000,
    timeout: 30000,
    ...connections.hooks,
    ...createDocumentHooks(rooms, documents.snapshot),
    onRequest: createHttpHandler(config, rooms, review, go),
  },
  { maxPayload: MAX_MESSAGE, perMessageDeflate: false }
);
connections.attachSocketLimits(server);
const stopRevalidation = connections.startRevalidation();
let shuttingDown = false;

/** 收到退出信号后先排空，再停止定时复核和监听；排空失败时保留进程以便恢复。 */
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await rooms.drain();
    stopRevalidation();
    await server.destroy();
    process.exit(0);
  } catch (error) {
    console.error(
      'Collaboration drain failed:',
      error instanceof Error ? error.message : 'unknown'
    );
    shuttingDown = false;
    process.exitCode = 1;
  }
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
// Hocuspocus 3.4.4 传入 address，但 node:http.listen 需要的是 host。
// 显式绑定 HTTPServer，确保内部接口只监听配置的回环地址。
await new Promise<void>((resolve, reject) => {
  server.httpServer.once('error', reject);
  server.httpServer.listen({ host, port }, () => {
    server.httpServer.off('error', reject);
    resolve();
  });
});
await server.hocuspocus.hooks('onListen', {
  instance: server.hocuspocus,
  configuration: server.configuration,
  port: server.address.port,
});
console.log(
  JSON.stringify({
    service: 'voex-collab',
    version: VERSION,
    schema_version: SCHEMA_VERSION,
    address: server.address.address,
    port: server.address.port,
  })
);
