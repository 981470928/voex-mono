# 文档历史版本

文档历史为每份文档提供版本时间线：自动快照、命名版本、只读预览、版本对比与恢复。正文以 Markdown 投影保存；恢复是显式覆盖动作，任何有文档编辑权限的人都可以恢复。

## 数据与行为边界

- 版本正文与文档正文同构（`file_content` 的 Markdown 投影），不保存 Yjs 二进制。协同文档恢复时由协同进程按目标 Markdown 重建 Yjs 状态（新 CRDT 身份），复用 AI 审阅的整篇替换语义（epoch 递增 + 房间丢弃重建）。
- `collaboration_commits` 回执与版本历史无关；版本行独立保存于 `document_versions`。
- 版本记录正文的作者：自动快照与恢复前备份取文档最后修改人，命名版本取操作者。修改人为空显示"未记录"，匿名修改显示"匿名用户"，与文件详情约定一致。
- 权限以 docs/PERMISSIONS.md 和当前 Go 实现为准：文档读权限可查看历史与预览，文档写权限可命名、删除命名版本与恢复。分享链接（含匿名只读分享）不开放历史接口。
- 文档进入回收站后历史不可访问，恢复文档后可再次读取；彻底删除文档时版本随外键级联删除。
- 历史功能由 `VOEX_HISTORY_ENABLED` 控制（默认开启）；关闭时不写快照、接口返回 404。

## 快照时机

| 时机 | 说明 | kind |
| --- | --- | --- |
| 自动快照 | 任何正文写入事务（协同提交、legacy 首次转换、AI 应用）在替换旧正文前采样：与最近版本正文相同或距最近版本不足 `VOEX_HISTORY_SNAPSHOT_INTERVAL`（默认 300 秒）时跳过 | `auto` |
| 基线版本 | 文档创建（手动或 AI 创建）时写入初始状态，保证最早可恢复点 | `auto` |
| 命名版本 | 用户在历史面板"保存当前版本"，可附标签 | `manual` |
| 恢复前备份 | 恢复与 AI 整篇替换等覆盖性操作前，保护当前正文；总是写入 | `backup` |

时间线 = 版本链 + 实时当前正文；每条版本记录其正文对应的 `revision`。

## 保留策略

由 `history_cleanup` 定时任务（每小时）执行，短事务分批删除，失败不影响业务：

- `auto`：7 天内全保留 → 8–30 天每（文档 × 小时）留 1 条 → 31–90 天每（文档 × 日）留 1 条 → 更旧删除。
- `manual`、`backup`：永久保留（直到文档彻底删除）；`manual` 可由用户删除，其他类型不可删。
- 保险丝：单文档 `auto` 超过 `VOEX_HISTORY_MAX_VERSIONS`（默认 500）时裁剪最旧条目。

## 恢复语义

- 恢复前当前内容保存为 `backup` 版本（响应返回 `pre_restore_version_id`），误恢复可再恢复回去。
- 恢复产出新的 `revision`；目标版本行本身不变。
- legacy 文档直接写入正文；协同文档先经协同进程 `prepare` 重建状态（文档有未落库的新修改时返回 409，请稍后重试），再在写事务内替换状态并递增 epoch，事务提交后经确认阶段与 outbox 丢弃房间，客户端完整握手重建。正在编辑的客户端本地修改按既有"文档版本已更新"提示处理，与应用 AI 审阅一致。

## 接口

全部要求登录，路径前缀 `/api`：

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET/HEAD | `/document/:fileKey/versions?limit=N&before=id` | 文档读 | 版本元数据列表（不含正文），按 id 倒序，游标分页。limit 必填且为正整数；before 为游标版本 id。返回 `{items, next_cursor}`，next_cursor 非空时作为下一页 before，空字符串表示没有更早版本。 |
| GET/HEAD | `/document/:fileKey/versions/:versionId` | 文档读 | 单版本详情（含 `content` 全文）。 |
| POST | `/document/:fileKey/versions` | 文档写 | 把当前正文保存为命名版本。body 可选 `label`（字符串，≤255 字符，允许为空）。返回版本详情（不含正文）。 |
| DELETE | `/document/:fileKey/versions/:versionId` | 文档写 | 删除命名版本；其他类型返回 403；版本不存在时仍返回成功。 |
| POST | `/document/:fileKey/versions/:versionId/restore` | 文档写 | 恢复到指定版本。返回 `{success, revision, restored_from, pre_restore_version_id}`。 |

版本 DTO 字段：`id`、`revision`、`kind`（`auto`/`manual`/`backup`）、`label`、`size`、`created_at`（UTC ISO）、`created_by_anonymous`、`creator`（`{id,name,avator}` 或 null，null 表示"未记录"）；详情另含 `content`。

## 运行配置

Go 的 `.env` 增加（均为可选，缺省即生效）：

~~~dotenv
VOEX_HISTORY_ENABLED=true
VOEX_HISTORY_SNAPSHOT_INTERVAL=300
VOEX_HISTORY_MAX_VERSIONS=500
~~~

`VOEX_HISTORY_ENABLED=true` 但缺少 `document_versions` 表时启动失败，需先执行迁移。

## 数据库

新空库使用当前 `internal/database/schema.sql`。已有数据库显式执行 `internal/database/document-history.sql`；该脚本只建 `document_versions` 表，**不回填历史数据**（历史从部署后开始记录）。空库自动补表逻辑已包含此表；仅当服务账号无建表权限时才需要手动执行。

清理与稀释只删除 `auto` 行，`manual`/`backup` 不受影响；结构变化仍由开发者显式维护并同步更新初始化 SQL。

## 验证

遵守项目约束，不生成、修改或运行单元测试。采用构建、`go vet`、类型检查、ESLint 与隔离数据库的 HTTP/浏览器集成验证，至少覆盖：

- 自动快照阈值与去重、创建基线版本、命名版本增删
- 列表分页与游标、预览渲染（含公式、流程图、卡片列表往返）、版本对比
- 恢复：legacy 与协同文档（epoch 递增、房间重建、其他在线客户端收到替换）、恢复前备份存在且可回退
- 权限：只读分享无历史、回收站不可访问、恢复文档后版本仍在、无写权限不能命名/恢复/删除
- 彻底删除级联清理；稀释各档位生效、`manual`/`backup` 不被稀释；上限裁剪
- 协同提交 409 语义不变；恢复与并发提交交错不产生死锁
