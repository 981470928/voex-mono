# 后端错误处理规范

适用于 Go API、AI SSE 与 Node 协作服务。错误分类由类型和状态决定；用户文案集中维护在各后端的常量表。

## 状态码和分类

| 情况 | 对外状态 | 处理约定 |
| --- | --- | --- |
| 参数、格式、权限、资源不存在、业务冲突 | 对应 4xx | 保留能帮助用户完成操作的业务提示 |
| 当前服务限流或并发限制 | `StatusTooManyRequests` | 提示稍后重试 |
| 连接、DNS、TLS、超时、上游拒绝或响应异常 | `StatusBadGateway` | 统一为“网络异常，请稍后重试” |
| 服务未启用或内部依赖未就绪 | `StatusServiceUnavailable` | 统一为“服务暂不可用，请稍后重试” |
| 未识别的内部异常 | `StatusInternalServerError` | 统一为“服务器处理失败，请稍后重试” |

- Go 使用标准库 `http.Status*`；Node 使用 `node:http2.constants.HTTP_STATUS_*`。禁止在调用、比较、switch 中直接写 HTTP 状态数字，也不另造一套等值 HTTP 枚举。
- 数据库错误使用 `errors.Is` 和 GORM 的 `ErrDuplicatedKey`、`ErrForeignKeyViolated`。`shared.DatabaseError` 调用当前 MySQL dialector 的原生 `Translate`，保留原始错误供日志使用；业务层不读取 `MySQLError.Number`，不比较报错字符串。
- 不再把锁等待、死锁、字段长度等数据库实现细节逐项映射为用户提示；未识别的数据库异常走统一内部错误。
- 数据库空库初始化有一个具名协议常量 `mysqlUnknownDatabase`：当前驱动未提供该错误的导出常量或 sentinel。它仅用于启动时判断缺库，不参与 API 业务错误分类。
- 已有自定义协议标识集中具名管理：`shared.CodeAIReviewConflict`、协作服务的 `SocketCloseCode` 与 `StatusClientClosedRequest`。框架没有等义常量的应用协议值保持兼容，禁止散落字面量。
- 只保留影响客户端行为的业务状态，例如登录续期、权限变更、文档版本冲突、请求过大。上游的鉴权、额度、限流和超时均不再拆成前端提示；当前服务自己的限流仍是 429。

## 文案常量

- Go 文案和模板直接声明在 `internal/shared/messages.go` 的 `const` 分组中，使用 `shared.Msg<Key>`；公共包内部直接使用 `Msg<Key>`。
- Node 协作服务在 `collab/src/errors.ts` 中使用 `Messages` 常量对象，其他模块从该文件导入。
- 修改文案只编辑对应的常量表，无需运行额外命令。新增前先复用现有文案或公共模板。
- 重复句式使用下述模板函数，不为 `limit`、`before` 等字段分别声明完整文案。字段名、实际边界值和单位由调用方提供。
- 模板函数只生成文案，不解析参数、不修改校验条件、不选择状态码。禁止把数据库、文件路径或上游返回内容作为模板参数。
- 禁止根据文案判断错误类型。刷新登录失败按 `StatusUnauthorized` 清理 Cookie，AI 审阅强制覆盖按既有具名协议标识判断。

## 重复句式模板

Go 的统一入口为 `internal/shared/message_templates.go`。

| 句式 | Go 函数 | 示例 |
| --- | --- | --- |
| 字段必须满足约束 | `MustBeMessage(field, requirement)` | `limit 必须是正整数` |
| 整数范围 | `IntegerRangeMessage(field, min, max)` | `limit 必须是1–50 的整数` |
| 最多 N 个字符 | `MaxCharactersMessage(field, max)` | `团队名称最多 128 个字符` |
| 字符数范围 | `CharacterRangeMessage(field, min, max)` | `搜索词需要 1–500 个字符` |
| 资源不存在 | `NotFoundMessage(resource)` | `文档不存在` |
| 格式错误 | `InvalidFormatMessage(field)` | `历史游标格式错误` |
| 超过大小限制 | `SizeLimitMessage(subject)` | `请求内容超过大小限制` |
| 大小上限及单位 | `MaxSizeMessage(subject, max, unit)` | `单个文件不能超过 5 MiB` |

已有项目调用示例：

```go
shared.Fail(http.StatusBadRequest,
    shared.MustBeMessage("limit", shared.MsgPositiveInteger))
shared.Fail(http.StatusBadRequest,
    shared.IntegerRangeMessage("limit", 1, 50))
```

`MsgPositiveInteger`、`MsgNonNegativeInteger`、`MsgStringType`、`MsgBooleanType` 等约束片段统一声明在常量表，不在各层重复维护。大小上限已有常量时，从相同常量换算显示值，避免提示与实际限制不一致。范围模板应与原校验类型匹配，字符数、字节数和数组项数不可互换。

Node 在 `collab/src/errors.ts` 中提供当前需要的 `mustBeMessage`、`notFoundMessage`、`invalidFormatMessage`、`sizeLimitMessage`，直接使用同一文件内的常量模板。不要直接返回带 `%s` 或 `%d` 的模板本身。

仅抽取句式完全可复用的提示。带有重连、重新登录、保留当前页面、重新上传、版本冲突处理等操作指引，以及团队归属、权限等业务含义的提示继续保留独立文案，不能为了套模板删去这些信息。

## 错误出口

Go 业务校验调用 `shared.Fail`；底层需要原样上抛的错误使用 `shared.Must`。外部请求失败使用 `shared.NetworkFailure(operation, err)`，非成功的上游状态使用 `shared.UpstreamFailure(operation, response.StatusCode)`。不得丢弃底层原因后再仅传一条泛化提示。

普通 JSON Recovery 和 AI SSE 都调用 `shared.PublicError`。普通响应保留 `{ "error": "…" }`；SSE 建流后 HTTP 仍为 200，通过 `event: error` 返回相同分类的 `error` 和 `status`，客户端必须读取事件状态。

Node 的 HTTP 控制面、保存通知及显式保存回复使用 `publicFailure`；Go 后端非成功响应仅按状态转换，不透传其正文。未知异常的 `error.message` 不得用于响应。转换失败、403、409、412、413 等已有业务状态继续保留，权限撤销、版本校验和原子保存流程保持原有规则。

## 日志

网络失败记录操作名称、错误类型、上游状态及底层原因；Node 使用 `Error.cause` 保留 fetch 或解码失败的原因，同一错误实例避免重复记录。内部错误记录服务端诊断信息，不返回前端。

Go 日志中的 URL 错误去除请求 URL，文件错误去除物理路径；数据库错误记录驱动类型、MySQL 编号和 SQLState，避免错误正文夹带 SQL 参数。不得记录密码、API Key、Authorization、Cookie、token、完整查询字符串或上游响应正文。响应已经发送后的异常也必须记录，不能再次写入 JSON。

## 修改后验证

按项目约束，不生成、不修改、不运行单元测试。执行 Go 格式检查、构建、`go vet`、模块校验，以及协作服务的 TypeScript 类型检查和打包。构建检查输出到临时目录，不覆盖运行中的二进制，也不自动重启协作进程。

框架依据：[Go HTTP 状态常量](https://pkg.go.dev/net/http#pkg-constants)、[GORM 错误处理](https://gorm.io/docs/error_handling.html)。具体 API 文档的错误示例应遵循本规范。
