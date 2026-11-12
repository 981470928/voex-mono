# AI 模型配置与文档审阅

所有接口沿用 `/api` 前缀与现有账号认证。配置、对话按登录用户隔离；文档操作继续使用项目权限。模型、应用记录与对话历史表定义统一保存在 `internal/database/schema.sql`，空库需手动初始化；服务启动不自动修改结构。

## 模型配置

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/ai/models` | 当前账号的配置列表，返回 `has_key`，不返回密钥 |
| PUT | `/ai/models/:id` | 创建或修改配置；id 使用调用方生成的 UUID |
| DELETE | `/ai/models/:id` | 删除自己的配置 |
| POST | `/ai/models/:id/chat` | 请求自己的配置对应的模型 |
| GET | `/ai/web/engines` | 可用搜索引擎，仅返回 ID 与名称 |
| POST | `/ai/web/search` | 使用选定引擎搜索公开网页 |
| POST | `/ai/web/fetch` | 获取公开网页并提取正文 |
| POST | `/ai/models/:id/attachments` | 校验并解析当前账号启用多模态的模型附件 |
| POST | `/ai/reviews/:id/apply` | 原子应用一份审阅，id 使用该快照的 UUID |
| GET | `/ai/conversations/:fileKey/sessions?before=...` | 按当前账号、文档读取最近 20 个会话 |
| PUT | `/ai/conversations/:fileKey/sessions/:id` | 幂等新建会话，接受空请求体或 `{}` |
| DELETE | `/ai/conversations/:fileKey/sessions/:id` | 删除当前账号在该文档下的会话及其消息、审阅快照 |
| GET | `/ai/conversations/:fileKey?session_id=...&before=...` | 读取指定会话最近 20 轮或游标之前的历史 |
| PUT | `/ai/conversations/:fileKey/turns/:id` | 保存一轮用户指令与未完成的助手消息 |
| PUT | `/ai/conversations/:fileKey/turns/:id/response` | 一次保存完成的回复及独立审阅快照 |
| GET | `/ai/reviews/:id` | 读取当前账号可访问的完整快照及真实应用状态 |

PUT 请求字段：`name`、`protocol`（`openai` / `anthropic`）、`base_url`、`model`、`api_key`、`temperature`（数字或 null）、`max_tokens`（1–131072）、`token_parameter`（`max_completion_tokens` / `max_tokens`，默认前者）。Claude 固定使用 `max_tokens`。Temperature 可留空，具体输出限额仍取决于第三方模型。`multimodal_enabled` 为可选布尔值，默认 `false`；列表与保存响应返回真实布尔值。只有用户在配置中手动开启后才能上传、发送附件，设置不会为上游模型增加其本身不支持的视觉能力。

地址允许公网 HTTPS Base URL 或完整接口地址；域名根路径补 `/v1`，OpenAI 补 `/chat/completions`，Claude 补 `/messages`。无凭据、query、fragment，禁止重定向、环境 HTTP 代理和私网目标。DNS 在实际连接时解析并固定经检查的地址。AI 请求不设置总时长和响应头等待时长上限；建立连接和 TLS 握手仍各受 15 秒限制。客户端中止会取消上游请求，并释放账号的进行中请求占用；响应仍最多 2 MiB。

Key 使用 AES-GCM 加密，随机 nonce，AAD 绑定账号和配置 ID；加密密钥由已有服务端 JWT secret 通过独立用途的 HMAC-SHA256 派生。备份或迁移必须保留原 `JWT_SECRET_FILE`；更换该密钥后旧配置需重新录入 Key。Key 不进入 URL、日志、列表响应或浏览器持久存储。修改时空 Key 保留旧密钥；更换地址或协议必须重填。每账号最多 30 个配置，最多一个进行中的模型请求。

Chat 请求接受 `messages`、`tools` 及 Claude 的 `system`。模型 ID、鉴权、目标地址、输出参数取自服务端保存的配置，不能由 chat 请求覆盖。上游模型继续使用 `stream: false` 完成每轮工具调用；未请求 SSE 的客户端仍收到对应协议原始 JSON。OpenAI 使用 `tools` / `tool_calls` / `tool` 消息；Claude 使用 `input_schema` / `tool_use` / `tool_result`。上游错误统一转换为 HTTP 502 和“网络异常，请稍后重试”，详细原因仅记日志，见 [错误处理规范](ERROR-HANDLING.md)。

## 独立联网工具

联网搜索位于输入框工具栏的独立图标中，展开后选择引擎（默认“无”表示关闭），按当前面板控制，不再作为模型配置保存。模型 DTO 和保存接口不再包含 `web_search_enabled`；旧数据库保留该历史列但不再读写，无需执行删除列迁移。新建数据库不再创建该列。旧客户端传来的原生 `web_search` / `web_search_*` 工具始终过滤，不请求模型服务商的联网插件。

在根目录 `voex.config.json` 配置 `"web_search_key": { "tavily": "tvly-...", "querit": "querit-sk-..." }`，启动脚本校验后以服务端环境变量 `VOEX_WEB_SEARCH_KEYS` 加载。各引擎 Key 非空时显示对应的 Tavily / Querit，留空或省略则隐藏；Bing RSS 永远可选且无需配置 Key。配置更改后重新启动服务生效。Key 不返回前端、不进入请求 URL 或错误日志。当前适配 Tavily、Querit 与 Bing RSS，新增引擎需同时扩展配置校验和服务端适配器。

- `GET /ai/web/engines` 返回 `{"engines":[{"id":"tavily","name":"Tavily"},{"id":"querit","name":"Querit"},{"id":"bing","name":"Bing RSS"}]}`，不含凭据。
- `POST /ai/web/search` 接受 `{"engine":"tavily","query":"搜索词","max_results":5}`；搜索词 1–500 字，数量 1–8（默认 5）。返回 `{"engine":"tavily","query":"搜索词","results":[{"title":"标题","url":"https://example.com/","content":"摘要"}]}`。Tavily 固定 basic 搜索，不自动升级深度；Querit 使用 `POST https://api.querit.ai/v1/search`，将数量映射为 `count`、`results.result[].snippet` 映射为摘要，检查 HTTP 状态和响应 `error_code`，不请求正文或高亮扩展；Bing 使用公开 RSS，服务可用性和结果相关性由 Bing 决定，遇到验证或限流返回明确错误，不伪装结果。
- `POST /ai/web/fetch` 接受 `{"engine":"bing","url":"https://example.com/"}`；引擎必须可用，抓取由项目后端直接执行，不消耗搜索引擎额度。返回 `{"url":"最终 URL","title":"标题","content":"正文","truncated":false}`。支持 HTML、纯文本和 Markdown；不执行 JavaScript、不携带登录 Cookie，不解析 PDF 等文件。正文最多 20000 字，截断时显式标记。

两个接口沿用账号认证，每账号共享每分钟 30 次限制，最多一个联网工具同时执行；每次最长 25 秒，响应最多 2 MiB。只允许标准端口的公网 HTTP/HTTPS URL，连接时解析并固定经过公网校验的 IP，重定向逐跳校验且最多 3 次，不使用环境代理，禁止内网、回环、云元数据地址。

Agent 通过普通 Function Calling 注册 `web_search(query,max_results?)`、`web_fetch(url)`，引擎由用户选择后固定注入，模型不能自行更换。每轮 chat 另带 `web_search_engine`（关闭时为空或省略），后端校验可用引擎，仅控制工具声明、不传给模型；关闭时同时过滤这两个函数工具。工具结果通过现有 `tool_calls` / `tool` 或 `tool_use` / `tool_result` 循环回传。网页和搜索结果仅作为不可信来源数据，模型应引用来源并如实说明搜索失败。


## 多模态附件

部署已有数据库前，显式执行 `internal/database/ai-multimodal.sql`，新增 `ai_models.multimodal_enabled` 和 `ai_conversation_turns.attachments`；迁移可重复执行，旧模型默认关闭，旧对话按无附件读取。空库 `schema.sql` 已包含两列；应用不自动修改已有列。

`POST /ai/models/:id/attachments` 使用 `multipart/form-data`，仅接受一个名为 `file` 的文件字段。首先校验当前账号拥有配置且已开启多模态，再读取文件。支持真实 JPEG、PNG、GIF、WebP 图片，以及 `.md`、`.txt`、`.doc`、`.docx`、`.ppt`、`.pptx`、`.xls`、`.xlsx`；扩展名不区分大小写，不接受 PDF、音频、视频及其他类型。图片校验实际编码、扩展名与像素上限（2000 万像素）；文本只提取内容，不执行宏、公式、链接或嵌入对象。MD/TXT 接受 UTF-8 和带 BOM 的 UTF-16。Office 表格使用缓存值；无缓存结果时以公式文字表示。

单文件最多 5 MiB、非空，每轮最多 4 个文件、原始大小合计最多 12 MiB，每个文件提取的文本最多 128 KiB；超过限制时提示拆分文件，不静默截断。OpenXML 解压后最多 32 MiB、最多 2048 个文件。旧版 DOC/PPT/XLS 使用系统 `catdoc`、`catppt`、`xls2csv`，Ubuntu/Debian 可通过 `apt-get install --no-upgrade catdoc` 安装；未安装时返回可操作的 503，不依赖前端 node_modules。解析子进程最多 15 秒，输出受限，临时原文件权限为 0600 并在请求结束时清理；不永久保存上传原文件。

返回 `{"id":"附件 UUID","name":"文件名","mime":"规范 MIME","size":原始字节数,"kind":"image|text","text":"提取文本","data":"图片 base64"}`，文本只有 `text`，图片只有不带 data URL 前缀的 `data`。解析结果先由客户端保留，开始一轮时随 `attachments` 数组提交；服务端重新校验内容、类型、大小和开关，再保存到该轮 JSON 列。开始轮次接口独立允许最多 32 MiB JSON，其他 JSON 接口仍限制 2 MiB。

开始请求示例：`{"session_id":"会话 UUID","model_id":"模型 UUID","prompt":"请分析上传的文件。","attachments":[...]}`。客户端仅上传文件时使用该默认指令，仍不接受空指令；没有附件可省略或传 `[]`。相同 turn ID 的幂等比较包含规范化后的完整附件内容。历史用户消息额外返回 `attachments` 元数据数组，只有 `id`、`name`、`mime`、`size`、`kind`，不会反复返回图片和提取文本。原始文件和解析结果都不会写入文档附件或正文。

Chat 的用户 `content` 数组使用 `{"type":"voex_attachment","turn_id":"所属轮次 UUID","attachment_id":"附件 UUID"}`，不可直接提交图片 data URL、外部图片 URL、document/file/audio/video 块或未知内容类型。服务端按当前账号读取该轮，再检查源文档当前读取权限，只能引用已保存附件。多模态模型将引用展开为文字块或对应协议的图片块；OpenAI 使用 `image_url` data URL，Claude 使用 `image` base64 source。工具结果与 thinking 块继续保留原有协议。

关闭模型多模态后，旧附件元数据仍可展示；客户端只发送普通文字和附件名称，不能继续发送附件引用或媒体块。展开后的完整上游请求最多 32 MiB，过大时提示新建对话或减少文件；上游响应仍限制 2 MiB。附件解析结果随所在轮次、会话、源文档和账号的既有删除规则清理，不增加公开下载地址。

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
data: {"error":"网络异常，请稍后重试","status":502}

```

客户端应忽略注释，直到收到 `result` 或 `error`；流结束前未收到终结事件应视为连接中断。停止、切换文档或关闭面板时通过 AbortSignal 断开连接；服务端同步取消上游和心跳，不自动重试模型调用。应用自身不限制 AI 总生成时长，代理应关闭该接口缓冲并允许 15 秒心跳持续通过；第三方模型服务仍可能执行自己的时间限制。

## 审阅应用

应用请求体接受 `{}`（或 `{"force":false}`）和用户确认后的 `{"force":true}`，只通过 URL 指定已保存的审阅 ID。`force` 必须为布尔值，携带 `changes` 或其他字段返回 400；应用内容始终来自后端已保存的快照，从未保存的快照不能应用。以下 change 字段在完成回复时保存在后端：

| 字段 | 含义 |
| --- | --- |
| `kind` | `create` / `update` |
| `file_key` | 原文件 key；新建时为前端 draft ID |
| `project_key`、`folder_key` | 新建落点，前端同时用于来源检查 |
| `before_name`、`after_name` | 修改前、后文件名 |
| `before_content`、`after_content` | 完整 Markdown 快照 |
| `revision` | 原文档版本号，新建为 0 |

返回 `[{"file_key":"...","file_name":"...","revision":2}]`。重复提交已成功的审阅时结果额外包含 `replayed: true`，客户端重新读取文件当前版本，避免响应丢失后将旧快照显示为最新正文。每次 1–20 个文件，单个新正文不超过 1 MiB，请求总大小沿用 2 MiB 限制。

应用事务使用现有 workspace 锁，重新检查写权限及创建落点。普通应用精确比较 revision、原文件名和原正文；原快照冲突返回 HTTP 409 和 `{"error":"文档已发生变化，本次修改未应用；可确认后强制应用此建议","code":"ai_review_conflict"}`，整批回滚，包括之前已经在事务内创建的文件。客户端仅对此错误码询问用户是否强制应用，其他 409 不提供强制覆盖提示。

用户确认后提交 `{"force":true}`，将该审阅的完整 `after_name`、`after_content` 覆盖到目标文档，可能覆盖建议生成后的编辑，不进行增量合并。强制应用只跳过与原审阅快照的比较，不绕过权限、创建落点、内容限制、协同准备或幂等检查。协同文档仍先暂停并保存已有修改，再构造新 Yjs 状态；提交时复查准备结果对应的当前 revision、seq、epoch 和 schema，准备后再次变化仍返回普通 409，要求重试。成功返回当前 revision + 1；启用历史版本时，覆盖正文前按实际当前正文保存 backup，供回退。

应用结果与审阅内容摘要在同一事务内记录；`force` 不参与摘要。相同账号、审阅 ID、摘要重试返回相同结果，不重复创建或更新，即使重试时切换了 `force`；相同 ID 不同摘要返回 409。取消审阅不调用该接口。客户端对未保存内容额外保护；后端事务是并发版本的最终检查。

## 前端能力扩展

`src/agent/registry.ts` 提供 `register(AgentTool)` 与注销函数。工具需要名称、说明、参数 schema 和执行回调，运行时拒绝未知工具及不符合 schema 的参数。核心 Agent 不持有编辑器、后端文件保存方法或任意代码执行能力。

`registerEditorTools` 注册当前文档的读写和特殊内容工具；`registerFileTools` 由编辑页传入创建/重命名权限回调，创建、改名只产生草稿。新增有副作用的工具需自行明确授权与审阅策略。

## 对话与快照持久化

一个账号在同一文档下可以保存多个独立会话。`ai_conversation_sessions` 用 `(user_id, document_id, session_id)` 唯一标识会话，`ai_conversation_turns` 的每轮记录通过相同字段关联；彻底删除账号或文档时同时级联清理会话。

会话列表返回 `{"sessions":[{"id":"会话 UUID","title":"新对话","createdAt":1720000000000,"updatedAt":1720000000000}],"nextCursor":"..."}`。时间为 Unix 毫秒。每页 20 条，按不可变的创建序号倒序排列；后续发送消息更新 updatedAt，但不改变会话列表排序或分页边界。nextCursor 非空时作为下一页的 before，空字符串表示没有更早会话。无历史的文档返回空列表，读取不会自动创建会话。

新建接口的 id 由客户端生成并在重试时保留，只接受 1–64 位英文字母、数字、下划线或连字符；同一账号、文档、id 重试返回原会话，不清空消息或改写标题。默认标题为“新对话”。会话第一条指令保存时会折叠空白为单空格，并取前 40 个 Unicode 字符作为标题；后续指令不改名。新建和列表都校验源文档读取权限。

删除会话接口沿用同一会话标识校验，并在 workspace 写事务内重新验证源文档读取权限；仅删除当前账号、指定文档、指定会话的记录。成功返回 `{"success":true}`，同一会话已不存在时仍返回成功，便于网络结果不明后安全重试；不存在或无权访问源文档仍返回既有权限错误。外键在同一事务中级联删除该会话的全部轮次、回复与审阅快照，不修改已应用的文档、不删除 `ai_review_applications` 的历史去重记录；删除后不能再通过原会话读取历史或打开、应用该快照。

会话删除与新建、开始/完成轮次、应用审阅使用同一 workspace 写锁串行执行。写入先完成时会一并删除该会话已保存的数据；删除先完成时，显式会话的新轮次和旧轮次的完成请求返回 404，不会将它们改挂到其他会话。显式再次调用同一会话 ID 的新建接口仍视为新建；旧客户端省略 session_id 时仍遵循下述 default 兼容行为。前端应在生成、保存及存在未保存回复时禁用删除，并在用户确认后发送 DELETE；服务端删除不负责取消已发往上游的模型请求。

兼容会话使用 id `default`、标题“历史对话”。没有历史的文档不预建默认会话。旧客户端省略 session_id 时读取或写入 default；首次旧客户端写入时按需创建默认会话。显式指定不存在的会话返回 404，不能将其他会话的轮次迁入当前会话。

`ai_conversation_turns` 的一行代表一轮用户指令和助手回复。唯一键仍为 `(user_id, turn_id)`；源文档通过 `document_id` 关联。完成回复后 `finish_hash` 锁定回复、活动记录、错误和快照内容，相同请求可重试，不同请求返回 409。`(user_id, review_id)` 唯一，不能将同一个审阅绑定到另一条回复。

开始一轮请求：`{"session_id":"会话 UUID","model_id":"配置 ID","prompt":"用户指令"}`。客户端生成并保留该轮 UUID；相同 ID、会话、模型和指令重试返回原记录，不追加重复消息；同一个 turn ID 换会话返回 409。开始时验证用户具有源文档读取权限，且配置属于自己。指令最多 64 KiB。

完成请求无需 session_id，由账号和 URL 中的 turn ID 定位原会话，不能变更归属。请求：`{"text":"回复","activity":["操作记录"],"error":"","review":{"id":"快照 UUID","changes":[...]}}`。没有修改时省略 review。回复最多 512 KiB，错误最多 16 KiB，活动最多 1100 条且每条最多 1 KiB（覆盖 50 轮模型请求、每轮最多 20 个工具调用产生的至多 1050 条记录）；快照仍受单文档 1 MiB 与请求总计 2 MiB 的限制。可以保存已经过期的建议供用户查看，但应用时仍会检查旧版本。客户端传入的 status 不作为应用状态来源。

两个写接口都返回该轮的 `[userMessage, assistantMessage]`。消息包含 `id`、`turnId`、`sequence`、`role`、`text`、`createdAt`；助手还包含 `state: incomplete | complete`、`activity`、`error` 和可选审阅摘要。摘要只有 `id`、`createdAt`、`status`、`fileCount`，不在历史列表中传输整份文档。GET review 按需返回相同摘要及 `changes`。

历史接口返回 `{"messages":[...],"nextCursor":"..."}`。每页最近 20 轮按时间顺序显示；nextCursor 非空时用作下一次 before，空值表示没有更早历史。采用序号游标，多个窗口追加不会导致已有历史丢失、重复或翻页偏移。开始后未完成的轮次会保留用户指令，刷新后明确显示未完成，不自动重新调用模型。

`ai_review_applications` 仍是已应用状态的唯一来源。文件变更和该记录同事务提交；查询历史/快照时关联得到 `pending` / `applied`，不会被后续回复保存覆盖。相同 ID 重复应用仍返回 replayed，并同步当前正文。所有读取和应用同时验证账号与源文档权限，目标写权限在应用事务中重验。

源文档进入回收站后历史暂不可访问，恢复后可再次读取；彻底删除源文档或账号时通过外键级联删除相应对话及正文快照。前端不使用 localStorage/IndexedDB 保存对话。旧版本从未发送到后端、且已随刷新清空的内存历史无法回溯恢复。
