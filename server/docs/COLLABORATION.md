# 多人协同接入与运行

本模块保留 Go 作为账号、文档权限和数据库事务的裁决方，独立 Node/Hocuspocus 进程负责 Yjs 房间、Awareness 和编辑器绑定。前端继续使用 Milkdown 7.22.1。仅支持一个协同进程实例。

## 数据与授权边界

- 公网通过 POST /api/collab/ticket 申请绑定文件的短期票据，WebSocket 使用 /api/collab/ws；长期账号或分享凭据不放入 WebSocket URL。
- 内部 /internal/collab/ 路由使用独立 X-Collab-Secret，公网入口必须拒绝此路径。Go 和 Node 使用同一私有 secret 文件。Node 只监听 loopback，不持有数据库账号。
- 权限以 docs/PERMISSIONS.md 和当前 Go 实现为准。匿名分享保持只读；登录后的文件授权、团队/项目授权和分享关闭行为保持当前规则。
- 长连接定期重新授权，权限、附件及删除事件经数据库 outbox 在事务提交后投递。续票成功时，Node 在更新授权和发送最新权限后显式返回 Hocuspocus 原生 authenticated 响应；当前版本不会自动为 onTokenSync 返回该响应。前端合并重复续期请求，并在认证帧发出后等待最多 20 秒；确认超时则保留同一 Y.Doc，通过完整握手重连，不能无限停留在 syncing。
- documents.content_mode 区分 legacy/collab。legacy 仅用于首次连接转换；普通 document PUT 只接受名称，不再接受正文，最近文件的旧正文 PUT 已删除。前端不保留 HTTP 正文保存队列，协同关闭或不可用时暂停编辑并保留错误恢复入口。
- Yjs 二进制、Markdown 投影、revision、最后修改者在同一事务提交。客户端收到对应持久化回执后才清除内部脏状态。界面静默保存，保留表达连接状态的云图标和心跳点；不显示成功/待保存/保存中文案或保存旋转动画，失败与断线仍提供必要反馈。连接成功和首次同步不是落库确认。
- 高频提交先取得 workspace_state 共享锁，再锁目标 document；不同文档可以并发，与现有全局独占结构/权限事务维持一致锁顺序。
- 首次转换在服务端完成并校验原 revision；已存在状态从二进制恢复，不在每次连接时重新从 Markdown 创建 Y.Doc。
- AI 保留服务端已保存审阅、快照冲突拒绝和幂等语义。准备阶段不修改正在广播的房间，数据库事务成功后应用；数据库事务内不等待 Node 网络回调。
- 断线保留当前页面的未提交内容并暂停编辑，重连重新授权。此版本不提供离线编辑或关闭页面后的离线草稿保证。
- 公式、流程图、卡片列表按现有节点数据结构同步。共享 schema 不承担浏览器 NodeView、弹窗或渲染器职责。

## 数据库

新空库使用当前 internal/database/schema.sql。已有数据库在备份并停止写入后，显式执行 internal/database/collaboration.sql；该脚本为一次性迁移，重复执行会报重复字段/表错误。不得把完整 schema.sql 导入已有业务库。

迁移新增 documents.content_mode、document_collaboration、collaboration_commits、collaboration_outbox。二进制读取使用 typed []byte，不经过把 byte slice 转字符串的通用 Row helper。协同状态与幂等记录随文档永久删除级联清理，软删除保留。

提交回执保留 7 天，每分钟最多清理 1000 条；超过保留期的旧请求仍受提交版本 CAS 保护，不能覆盖新状态。它不是用户版本历史。

Go 启动时会补齐缺失的表。已有表所需的协同字段由显式迁移维护，迁移完成后再设置 `VOEX_COLLAB_ENABLED=true`。

## 启用协同编辑

在 `server/.env` 中设置：

```dotenv
VOEX_COLLAB_ENABLED=true
VOEX_COLLAB_URL=http://127.0.0.1:8091
VOEX_COLLAB_SECRET_FILE=/home/server/.secrets/collab-key
VOEX_COLLAB_WS_URL=/api/collab/ws
```

从 `server/collab/.env.example` 复制一份 `server/collab/.env`。两个配置文件的 `VOEX_COLLAB_SECRET_FILE` 必须指向同一个私有文件，内容至少 32 字节。已有实例沿用原密钥。新实例可在 `server/` 下执行以下命令生成密钥，将输出的绝对路径填入两份配置。

```sh
mkdir -p .secrets
(umask 077 && set -C && openssl rand -hex 32 > .secrets/collab-key)
realpath .secrets/collab-key
```

Node 默认监听 `127.0.0.1:8091`，通过 `http://127.0.0.1:8090` 回调 Go。调整端口时，同步两端的 `VOEX_COLLAB_URL`、`VOEX_COLLAB_PORT`、`VOEX_COLLAB_API_URL` 和前端开发代理地址。WebSocket 路径是 `/api/collab/ws`，代理需保留浏览器的 `Host` 以通过同源校验。

启动 Go API 后，在另一终端按[协同服务 README](../collab/README.md#build-and-run) 手动构建并启动 Node。开发时由 Vite 代理协同 WebSocket。

## 停止和恢复

先在协同进程按 Ctrl+C，再停止 Go API。Node 收到 SIGINT 或 SIGTERM 后会停止接收编辑并将待保存内容写回 Go。若排空失败，Node 会保留进程并打印错误，需要保持 Go 在线，排查后再次请求停止。已收到持久化回执的内容可在重启后从数据库恢复。

数据库迁移前应停止写入并备份。恢复旧版本时，Go、Node、共享编辑器 schema 和数据库结构需与备份匹配。

## 验证

遵守项目约束，不生成、修改或运行单元测试。采用构建、go vet、类型检查、ESLint 和隔离数据库的 HTTP/WebSocket/浏览器集成验证。验证库与端口必须与业务环境隔离。

至少覆盖：两个独立客户端同步与各自撤销、删除字符后的保存回执、只读分享、账号权限撤销、未授权房间拒绝、旧全文接口拒绝、断线/重连、服务重启后恢复、自定义节点往返、AI 冲突与安全重试、附件通知、回收站和排空流程。容量和同时在线数量需要按部署资源单独测量。

本次实现的验收记录见 [协同接入验收](COLLABORATION-VALIDATION.md)。
