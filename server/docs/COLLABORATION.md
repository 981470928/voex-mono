# 多人协同接入与运行

本模块保留 Go 作为账号、文档权限和数据库事务的裁决方，独立 Node/Hocuspocus 进程负责 Yjs 房间、Awareness 和编辑器绑定。前端继续使用 Milkdown 7.22.1。仅支持一个协同进程实例，不要开启 PM2 cluster 或同时运行多个实例。

## 数据与授权边界

- 公网通过 POST /api/collab/ticket 申请绑定文件的短期票据，WebSocket 使用 /api/collab/ws；长期账号或分享凭据不放入 WebSocket URL。
- 内部 /internal/collab/ 路由使用独立 X-Collab-Secret，Nginx 公网入口必须拒绝此路径。Go 和 Node 使用同一私有 secret 文件。Node 只监听 loopback，不持有数据库账号。
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

启动不会执行 DDL。协同开启时 Go 检查必要结构和服务配置；没有完成迁移的环境保持 VOEX_COLLAB_ENABLED=false。

## 运行配置

Go 的 .env 增加：

~~~dotenv
VOEX_COLLAB_ENABLED=true
VOEX_COLLAB_URL=http://127.0.0.1:8091
VOEX_COLLAB_SECRET_FILE=/home/server/.secrets/collab-key
VOEX_COLLAB_WS_URL=/api/collab/ws
~~~

Node 使用单独的 collab/.env，内容参考 deploy/collaboration/collab.env.example。Node.js 至少满足当前项目要求，服务器当前为 24.x；前后端依赖均使用 lockfile。VOEX_COLLAB_ORIGINS 必须配置浏览器实际的 scheme/host/port，不包含路径、不使用通配符。

生成共享密钥时不得覆盖已有文件：

~~~bash
install -d -m 700 /home/server/.secrets
(set -o noclobber; umask 077; openssl rand -hex 32 > /home/server/.secrets/collab-key)
~~~

若使用非 root 服务账号，部署人员应为两个服务配置同一受限组的只读权限，保持文件非公开；不要把真实密钥写入仓库或命令行参数。

## 构建与启动

在远程服务器源码目录构建，不将本地源码上传服务器：

~~~bash
cd /home/voex-server
./deploy/collaboration/build.sh
~~~

脚本顺序安装 lockfile 固定依赖、类型检查并构建前端、构建 Node 和 Go，将制品放入新的 dist/collaboration-* 目录，生成 SHA256SUMS。已有输出目录会被拒绝。脚本不修改数据库、不更新正在运行的二进制、不重启现有服务。

当前源码运行可使用 PM2：

~~~bash
cd /home/voex-server
cp -n deploy/collaboration/collab.env.example collab/.env
chmod 600 collab/.env
# 按实际域名和端口配置 collab/.env。
pm2 start deploy/collaboration/ecosystem.config.cjs --only voex-collab
~~~

该配置只管理 voex-collab，不重建现有 voex-server 或 voex-dev。也可按 voex-collab.service.example 配置 systemd；两种管理方式只能选择一种，需先调整运行账号和实际路径。

将 nginx.conf.example 中的 location 合入现有站点，检查 nginx -t 后再通过既有运维流程加载。保持现有 /api/、前端和附件路由。开发环境由 Vite 分别代理普通 API 与协同 WebSocket。

## 更新、停止和恢复

可使用以下命令请求排空。失败时不得继续停止 API：

~~~bash
cd /home/voex-server
node --env-file=collab/.env deploy/collaboration/drain.mjs
~~~


1. 关闭外部新写入入口，并调用协同进程受保护的 drain 接口，等待已接收更改持久化；失败时保留原服务并排查，不能继续标记成功。
2. 停止协同进程，再停止 Go API；确认没有写入者后备份数据库及必要配置。
3. 执行明确适用的 SQL 迁移，切换匹配的 Go、Node、共享 schema 与前端制品。
4. 启动 Go、Node，核对各自健康状态，再开放浏览器入口。内部健康端点不依赖彼此的 ready，避免递归检查。
5. 恢复同样先停止全部写入者，恢复匹配数据和制品。回到不支持协同的旧 Go 版本前必须有停写快照和显式数据回退方案；仅关闭开关不是数据格式回退。

进程收到 SIGTERM/SIGINT 时应排空待保存房间。进程管理器的停止超时配置为 30 秒。被强制终止前没有持久化回执的修改可能仍只存在于客户端页面；前端不得把它显示为已保存。

## 验证

遵守项目约束，不生成、修改或运行单元测试。采用构建、go vet、类型检查、ESLint 和隔离数据库的 HTTP/WebSocket/浏览器集成验证。验证库与端口必须与业务环境隔离。

至少覆盖：两个独立客户端同步与各自撤销、删除字符后的保存回执、只读分享、账号权限撤销、未授权房间拒绝、旧全文接口拒绝、断线/重连、服务重启后恢复、自定义节点往返、AI 冲突与安全重试、附件通知、回收站和排空流程。容量和同时在线数量需要按部署资源单独测量。

本次实现的验收记录见 [协同接入验收](COLLABORATION-VALIDATION.md)。
