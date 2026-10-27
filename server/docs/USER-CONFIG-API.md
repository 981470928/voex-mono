# 用户级配置 API

API 前缀为 `/api`，沿用现有 Bearer access token / 登录 Cookie 鉴权。配置只属于当前登录账号，不按团队或项目区分；账号由服务端登录态确定，前端无需传用户 ID。

## 读取

`GET /api/auth/me/config`（同时支持 HEAD）

返回 HTTP 200：

```json
{"userConfig": {}}
```

新用户的初始配置为 `{}`。响应始终包含完整配置对象。

## 新增或修改

`PATCH /api/auth/me/config`

请求头为 `Content-Type: application/json`，请求体：

```json
{
  "userConfig": {
    "theme": "dark",
    "editor": {"fontSize": 16},
    "showSidebar": false
  }
}
```

新增字段与修改已有字段共用这一个写入接口。后端只要求 `userConfig` 是至少包含一个属性的 JSON 对象，不校验内部字段名称、业务结构或值类型。字符串、数字、布尔值、数组、对象及 `null` 均可作为字段值；`false`、`0`、空字符串、空数组和空对象也会正常保存。

后端执行与 `Object.assign(existingUserConfig, userConfig)` 相同的浅合并：

- 未传入的顶层字段保留。
- 新顶层字段直接新增，同名字段整体覆盖。
- 嵌套对象和数组整体替换，不递归合并。
- `null` 保存为 JSON null，不表示删除字段。
- 成功返回 HTTP 200 和合并后的完整 `{"userConfig": {...}}`，请求失败不提交修改。

例如已有配置：

```json
{"theme":"dark","editor":{"fontSize":16,"lineNumbers":true}}
```

提交：

```json
{"userConfig":{"theme":"light","editor":{"fontSize":18},"autosave":false}}
```

得到：

```json
{"userConfig":{"theme":"light","editor":{"fontSize":18},"autosave":false}}
```

只传 `{"userConfig":{"theme":"light"}}` 时，已有 `editor` 会完整保留。

## 错误与并发

| 状态 | 条件 |
| --- | --- |
| 400 | 缺少 `userConfig`，或为 `{}`、`null`、数组、字符串、数字、布尔值 |
| 400 | 请求体不是 JSON 对象或 JSON 格式无效，沿用公共请求解析规则 |
| 401 | 未登录或会话失效 |
| 413 | 请求体超过公共 JSON 接口的 2 MiB 限制 |

非空对象校验失败返回 `{"error":"userConfig 必须是非空 JSON 对象"}`。不额外提供删除或清空配置接口。

每次合并在事务中锁定当前用户的数据库行后读取最新配置，避免并发修改不同字段时互相覆盖。并发修改同一个字段时，以后取得行锁并完成合并的请求为准；不同账号的配置相互隔离。已保存的 JSON 数字读取和合并时保留数值文本，避免转换为 float64 引入精度丢失。

## 数据库结构

`users.user_config` 定义为 `JSON NOT NULL DEFAULT (JSON_OBJECT())`，新账号使用空对象默认值。

空库初始化结构见 `internal/database/schema.sql`；开发阶段已有数据库由开发者显式维护，服务启动不自动执行 DDL。
