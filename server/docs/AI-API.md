# AI 模型配置与文档审阅

所有接口沿用 `/api` 前缀与现有账号认证。配置、对话按登录用户隔离；文档操作继续使用项目权限。模型、应用记录与对话历史表定义统一保存在 `internal/database/schema.sql`，空库需手动初始化；服务启动不自动修改结构。

## 模型配置

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/ai/models` | 当前账号的配置列表，返回 `has_key`，不返回密钥 |
| PUT | `/ai/models/:id` | 创建或修改配置；id 使用调用方生成的 UUID |
| DELETE | `/ai/models/:id` | 删除自己的配置 |
| POST | `/ai/models/:id/chat` | 请求自己的配置对应的模型 |
| POST | `/ai/reviews/:id/apply` | 原子应用一份审阅，id 使用该快照的 UUID |
| GET | `/ai/conversations/:fileKey/sessions?before=...` | 按当前账号、文档读取最近 20 个会话 |
| PUT | `/ai/conversations/:fileKey/sessions/:id` | 幂等新建会话，接受空请求体或 `{}` |
| DELETE | `/ai/conversations/:fileKey/sessions/:id` | 删除当前账号在该文档下的会话及其消息、审阅快照 |
| GET | `/ai/conversations/:fileKey?session_id=...&before=...` | 读取指定会话最近 20 轮或游标之前的历史 |
| PUT | `/ai/conversations/:fileKey/turns/:id` | 保存一轮用户指令与未完成的助手消息 |
| PUT | `/ai/conversations/:fileKey/turns/:id/response` | 一次保存完成的回复及独立审阅快照 |
| GET | `/ai/reviews/:id` | 读取当前账号可访问的完整快照及真实应用状态 |

PUT 请求字段：`name`、`protocol`（`openai` / `anthropic`）、`base_url`、`model`、`api_key`、`temperature`（数字或 null）、`max_tokens`（1–131072）、`token_parameter`（`max_completion_tokens` / `max_tokens`，默认前者）。Claude 固定使用 `max_tokens`。Temperature 可留空，具体输出限额仍取决于第三方模型。

地址允许公网 HTTPS Base URL 或完整接口地址；域名根路径补 `/v1`，OpenAI 补 `/chat/completions`，Claude 补 `/messages`。无凭据、query、fragment，禁止重定向、环境 HTTP 代理和私网目标。DNS 在实际连接时解析并固定经检查的地址。AI 请求不设置总时长和响应头等待时长上限；建立连接和 TLS 握手仍各受 15 秒限制。客户端中止会取消上游请求，并释放账号的进行中请求占用；响应仍最多 2 MiB。

Key 使用 AES-GCM 加密，随机 nonce，AAD 绑定账号和配置 ID；加密密钥由已有服务端 JWT secret 通过独立用途的 HMAC-SHA256 派生。备份或迁移必须保留原 `JWT_SECRET_FILE`；更换该密钥后旧配置需重新录入 Key。Key 不进入 URL、日志、列表响应或浏览器持久存储。修改时空 Key 保留旧密钥；更换地址或协议必须重填。每账号最多 30 个配置，最多一个进行中的模型请求。

Chat 请求接受 `messages`、`tools` 及 Claude 的 `system`。模型 ID、鉴权、目标地址、输出参数取自服务端保存的配置，不能由 chat 请求覆盖。上游模型继续使用 `stream: false` 完成每轮工具调用；未请求 SSE 的客户端仍收到对应协议原始 JSON。OpenAI 使用 `tools` / `tool_calls` / `tool` 消息；Claude 使用 `input_schema` / `tool_use` / `tool_result`。上游错误转换为不携带原始响应或密钥的 502 提示。

## Chat 流式传输与心跳

`POST /ai/models/:id/chat` 支持通过 `Accept: text/event-stream` 显式启用 SSE；请求体、认证、模型配置和工具协议均不变，不带此 Accept 的旧客户端仍沿用同步 JSON 响应。

通过认证并校验路径、JSON 请求体后，服务端立即返回 HTTP 200、`Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache`、`X-Accel-Buffering: no`，发送 `: connected` 注释并刷新响应；等待模型期间每 15 秒发送 `: heartbeat` 注释并刷新。心跳不包含模型文本，不代表 token 增量；每次调用仍只交付一份完整模型 JSON。

成功后发送一个 `result` 事件，data 为压缩到单行的完整原协议 JSON，然后关闭流：

```text
event: result
data: {"choices":[{"message":{"content":"..."}}]}

```

流已建立后，业务或模型失败发送一个 `error` 事件，然后关闭流；data 为 `{"error":"安全错误提示","status":502}`，status 使用既有业务错误映射。HTTP 状态在响应头发送后仍为 200，客户端必须检查事件；不会传回上游错误正文、密钥、数据库细节或 panic 内容。认证、路径和请求体校验等建流前错误继续使用原 HTTP 状态及 `{error: ...}` JSON。

```text
event: error
data: {"error":"无法连接模型服务，请检查公网 HTTPS 地址或稍后重试","status":502}

```

客户端应忽略注释，直到收到 `result` 或 `error`；流结束前未收到终结事件应视为连接中断。停止、切换文档或关闭面板时通过 AbortSignal 断开连接；服务端同步取消上游和心跳，不自动重试模型调用。应用自身不限制 AI 总生成时长，代理应关闭该接口缓冲并允许 15 秒心跳持续通过；第三方模型服务仍可能执行自己的时间限制。

## 审阅应用

应用请求体固定为 `{}`，只通过 URL 指定已保存的审阅 ID。携带 `changes` 或其他内容返回 400；从未保存的快照不能应用。以下 change 字段在完成回复时保存在后端：

| 字段 | 含义 |
| --- | --- |
| `kind` | `create` / `update` |
| `file_key` | 原文件 key；新建时为前端 draft ID |
| `project_key`、`folder_key` | 新建落点，前端同时用于来源检查 |
| `before_name`、`after_name` | 修改前、后文件名 |
| `before_content`、`after_content` | 完整 Markdown 快照 |
| `revision` | 原文档版本号，新建为 0 |

返回 `[{"file_key":"...","file_name":"...","revision":2}]`。重复提交已成功的审阅时结果额外包含 `replayed: true`，客户端重新读取文件当前版本，避免响应丢失后将旧快照显示为最新正文。每次 1–20 个文件，单个新正文不超过 1 MiB，请求总大小沿用 2 MiB 限制。

应用事务使用现有 workspace 锁，重新检查写权限及创建落点。更新文件同时精确比较 revision、原文件名和原正文；冲突返回 409，整批回滚，包括之前已经在事务内创建的文件。不提供强制覆盖旧建议的入口。

应用结果与请求摘要在同一事务内记录。相同账号、审阅 ID、摘要重试返回相同结果，不重复创建或更新；相同 ID 不同摘要返回 409。取消审阅不调用该接口。客户端对未保存内容额外保护；后端事务是并发版本的最终检查。

## 前端能力扩展

`src/agent/registry.ts` 提供 `register(AgentTool)` 与注销函数。工具需要名称、说明、参数 schema 和执行回调，运行时拒绝未知工具及不符合 schema 的参数。核心 Agent 不持有编辑器、后端文件保存方法或任意代码执行能力。

`registerEditorTools` 注册当前文档的读写和特殊内容工具；`registerFileTools` 由编辑页传入创建/重命名权限回调和导出回调。创建、改名只产生草稿；导出需要当前轮用户授权，通过现有读文档接口下载已保存正文为 `.md`，保留附件引用但不打包附件二进制文件。新增有副作用的工具需自行明确授权与审阅策略。

## 对话与快照持久化

一个账号在同一文档下可以保存多个独立会话。`ai_conversation_sessions` 用 `(user_id, document_id, session_id)` 唯一标识会话，`ai_conversation_turns` 的每轮记录通过相同字段关联；彻底删除账号或文档时同时级联清理会话。

会话列表返回 `{"sessions":[{"id":"会话 UUID","title":"新对话","createdAt":1720000000000,"updatedAt":1720000000000}],"nextCursor":"..."}`。时间为 Unix 毫秒。每页 20 条，按不可变的创建序号倒序排列；后续发送消息更新 updatedAt，但不改变会话列表排序或分页边界。nextCursor 非空时作为下一页的 before，空字符串表示没有更早会话。无历史的文档返回空列表，读取不会自动创建会话。

新建接口的 id 由客户端生成并在重试时保留，只接受 1–64 位英文字母、数字、下划线或连字符；同一账号、文档、id 重试返回原会话，不清空消息或改写标题。默认标题为“新对话”。会话第一条指令保存时会折叠空白为单空格，并取前 40 个 Unicode 字符作为标题；后续指令不改名。新建和列表都校验源文档读取权限。

删除会话接口沿用同一会话标识校验，并在 workspace 写事务内重新验证源文档读取权限；仅删除当前账号、指定文档、指定会话的记录。成功返回 `{"success":true}`，同一会话已不存在时仍返回成功，便于网络结果不明后安全重试；不存在或无权访问源文档仍返回既有权限错误。外键在同一事务中级联删除该会话的全部轮次、回复与审阅快照，不修改已应用的文档、不删除 `ai_review_applications` 的历史去重记录；删除后不能再通过原会话读取历史或打开、应用该快照。

会话删除与新建、开始/完成轮次、应用审阅使用同一 workspace 写锁串行执行。写入先完成时会一并删除该会话已保存的数据；删除先完成时，显式会话的新轮次和旧轮次的完成请求返回 404，不会将它们改挂到其他会话。显式再次调用同一会话 ID 的新建接口仍视为新建；旧客户端省略 session_id 时仍遵循下述 default 兼容行为。前端应在生成、保存及存在未保存回复时禁用删除，并在用户确认后发送 DELETE；服务端删除不负责取消已发往上游的模型请求。

兼容会话使用 id `default`、标题“历史对话”。没有历史的文档不预建默认会话。旧客户端省略 session_id 时读取或写入 default；首次旧客户端写入时按需创建默认会话。显式指定不存在的会话返回 404，不能将其他会话的轮次迁入当前会话。

`ai_conversation_turns` 的一行代表一轮用户指令和助手回复。唯一键仍为 `(user_id, turn_id)`；源文档通过 `document_id` 关联。完成回复后 `finish_hash` 锁定回复、活动记录、错误和快照内容，相同请求可重试，不同请求返回 409。`(user_id, review_id)` 唯一，不能将同一个审阅绑定到另一条回复。

开始一轮请求：`{"session_id":"会话 UUID","model_id":"配置 ID","prompt":"用户指令"}`。客户端生成并保留该轮 UUID；相同 ID、会话、模型和指令重试返回原记录，不追加重复消息；同一个 turn ID 换会话返回 409。开始时验证用户具有源文档读取权限，且配置属于自己。指令最多 64 KiB。

完成请求无需 session_id，由账号和 URL 中的 turn ID 定位原会话，不能变更归属。请求：`{"text":"回复","activity":["操作记录"],"error":"","review":{"id":"快照 UUID","changes":[...]}}`。没有修改时省略 review。回复最多 512 KiB，错误最多 16 KiB，活动最多 240 条且每条最多 1 KiB；快照仍受单文档 1 MiB 与请求总计 2 MiB 的限制。可以保存已经过期的建议供用户查看，但应用时仍会检查旧版本。客户端传入的 status 不作为应用状态来源。

两个写接口都返回该轮的 `[userMessage, assistantMessage]`。消息包含 `id`、`turnId`、`sequence`、`role`、`text`、`createdAt`；助手还包含 `state: incomplete | complete`、`activity`、`error` 和可选审阅摘要。摘要只有 `id`、`createdAt`、`status`、`fileCount`，不在历史列表中传输整份文档。GET review 按需返回相同摘要及 `changes`。

历史接口返回 `{"messages":[...],"nextCursor":"..."}`。每页最近 20 轮按时间顺序显示；nextCursor 非空时用作下一次 before，空值表示没有更早历史。采用序号游标，多个窗口追加不会导致已有历史丢失、重复或翻页偏移。开始后未完成的轮次会保留用户指令，刷新后明确显示未完成，不自动重新调用模型。

`ai_review_applications` 仍是已应用状态的唯一来源。文件变更和该记录同事务提交；查询历史/快照时关联得到 `pending` / `applied`，不会被后续回复保存覆盖。相同 ID 重复应用仍返回 replayed，并同步当前正文。所有读取和应用同时验证账号与源文档权限，目标写权限在应用事务中重验。

源文档进入回收站后历史暂不可访问，恢复后可再次读取；彻底删除源文档或账号时通过外键级联删除相应对话及正文快照。前端不使用 localStorage/IndexedDB 保存对话。旧版本从未发送到后端、且已随刷新清空的内存历史无法回溯恢复。
