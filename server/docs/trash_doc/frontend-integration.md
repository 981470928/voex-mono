# Trash 前端开发对接文档

更新时间：2026-10-14

本文用于实现回收站列表、移入回收站、恢复和彻底删除。接口约定按当前仓库代码整理；已完成构建和静态检查，尚未执行数据库及 HTTP 联调，也未确认目标环境已部署这些改动。下面的请求与响应示例均为格式示例，标识和时间为虚构值。

普通文档、文件夹的删除入口现在表示“移入回收站”。回收站中的“彻底删除”使用单独接口。**项目删除仍然是彻底删除，不具备恢复能力。**

## 接口总览

以下路径已经包含 `/api`。如果项目请求实例的 `baseURL` 已经是 `/api`，调用时使用 `/trash` 等相对路径，避免重复前缀。

| 方法 | 路径 | 用途 | 成功响应 |
| --- | --- | --- | --- |
| GET | `/api/trash` | 分页查询回收站 | `{ items, total, limit, offset }` |
| HEAD | `/api/trash` | 使用与 GET 相同的参数和鉴权，仅返回响应头 | 无响应正文 |
| POST | `/api/trash/:type/:key/restore` | 恢复一个对象 | `{ "success": true }` |
| DELETE | `/api/trash/:type/:key` | 彻底删除一个回收站对象 | `{ "success": true }` |
| DELETE | `/api/document/:fileKey` | 将文档移入回收站 | `{ "success": true }` |
| DELETE | `/api/folder/:folderKey` | 将文件夹移入回收站，支持 cascade 参数 | `{ "success": true }` |

所有成功响应均为 HTTP 200，响应直接是上述 JSON，不包裹在 `data` 中。POST 恢复和这些 DELETE 请求均无需请求体。

当前没有批量恢复、批量彻底删除、清空整个回收站、回收站内容预览或恢复到其他目录的接口。

## 登录和权限

- 所有接口要求登录。沿用现有的 `voex_access` Cookie 或 `Authorization: Bearer <accessToken>`。
- 请求存在 `Authorization` 头时，后端优先读取该头；格式错误时不会再回退读取 Cookie。不要发送空的 Authorization 头。
- 使用 Cookie 的 Fetch 请求带上 `credentials: "include"`。Cookie 为 HttpOnly，前端无需读取。
- 跨源请求需要后端允许前端 Origin；`credentials: "include"` 不能绕过 Cookie 的 SameSite 限制。当前 Cookie 使用 SameSite=Strict，优先沿用项目已有的同源代理或认证部署方式。
- 查看、恢复和彻底删除都依据**当前项目写权限**。用户可以管理有写权限项目内其他成员删除的内容，不按创建人或删除人过滤。
- 分享链接提供的 read/edit 权限不授予回收站管理权限。
- 项目入口的操作按钮可依据所属项目的 `permissions.write` 展示。操作请求仍会重新鉴权，离队或权限变化后可能返回 404。

认证与会话处理沿用[现有认证接口](../AUTH-API.md)，不要为 Trash 单独实现一套登录或刷新机制。

## 查询回收站

### 请求参数

```http
GET /api/trash?team_key=70b47e2d1a4e4cb2&project_key=bfe25c68e9a04a12&limit=50&offset=0
```

| 参数 | 类型 | 默认行为 | 约束 |
| --- | --- | --- | --- |
| `team_key` | string，可选 | 查询当前账号的个人团队 | 指定时要求当前用户仍属于该团队 |
| `project_key` | string，可选 | 查询所选团队中所有有写权限的项目 | 项目必须属于所选团队，且当前用户有写权限 |
| `limit` | integer，可选 | 50 | 1～200 |
| `offset` | integer，可选 | 0 | 大于等于 0 |

每个参数只发送一次，使用普通标量形式。未提供与空字符串含义不同：例如 `limit=`、`team_key=` 会返回 400。标识应原样使用服务端返回值，不能带首尾空白，最长 64 个 Unicode 字符。

**只传 project_key 时，团队仍默认是个人团队，不会自动推断项目所属团队。** 查询普通团队的项目时，同时发送该团队的 `team_key`。

- 团队不存在或当前用户不是成员：404。
- 指定项目不存在、不属于所选团队或没有写权限：404。
- 未限定项目，且所选团队内没有可管理的记录：200，`items: []`、`total: 0`。
- 超出最后一页：返回空 `items`，`total` 仍表示符合条件的记录总数。

### 返回字段

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `items` | TrashItem[] | 当前页记录，空列表为 `[]` |
| `total` | number | 权限筛选后、尚未到期的记录总数，不是当前页条数 |
| `limit` | number | 本次使用的每页数量 |
| `offset` | number | 本次使用的偏移量 |

每条记录的字段如下：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `type` | `"document" \| "folder"` | 对象类型 |
| `key` | string | 对象公开标识；文档对应 file_key，文件夹对应 folder_key |
| `name` | string | 文档或文件夹名称，允许出现同名记录 |
| `team_key` | string | 所属团队标识 |
| `project_key` | string | 所属项目标识 |
| `folder_key` | string 或 null | 文档的原文件夹标识；文件夹记录本身为 null |
| `deleted_by` | `{ id: string; name: string } \| null` | 删除人；name 是用户当前显示名称 |
| `deleted_at` | string | 删除时间，UTC ISO 字符串 |
| `expires_at` | string | 本次回收记录的到期时间，UTC ISO 字符串 |
| `can_restore` | boolean | 当前查询时是否具备恢复所需的目录状态 |
| `document_count` | number，仅文件夹返回 | 文件夹内全部文档数量，包括此前单独删除、尚未清理的文档 |

注意以下字段差异：

- 文档项使用 `key`、`name`，不是普通文档 DTO 的 `file_key`、`file_name`。
- 文件夹自己的 key 在 `key` 中，不能使用该行值为 null 的 `folder_key` 调用恢复或彻底删除。
- 文档项不返回 `document_count`，不是返回 null。
- 不返回正文、附件清单、文件大小、项目名称或完整路径。所属项目名称可从已有项目数据映射。
- 列表行标识建议使用 `type + ":" + key`，不使用名称或单独的数字 id。

### 响应示例

示例中，文档先被单独删除，随后其文件夹也被删除，因此文档的 `can_restore` 为 false：

```json
{
  "items": [
    {
      "type": "folder",
      "key": "9b6fa8e2c1404d57",
      "name": "产品资料",
      "team_key": "70b47e2d1a4e4cb2",
      "project_key": "bfe25c68e9a04a12",
      "folder_key": null,
      "deleted_by": {
        "id": "92f1bcb2-4e69-4a02-8ae0-1e115cf1e0d3",
        "name": "示例用户"
      },
      "deleted_at": "2026-10-13T10:00:00.000Z",
      "expires_at": "2026-11-12T10:00:00.000Z",
      "can_restore": true,
      "document_count": 2
    },
    {
      "type": "document",
      "key": "14c6e9a82b3f4d05",
      "name": "功能说明",
      "team_key": "70b47e2d1a4e4cb2",
      "project_key": "bfe25c68e9a04a12",
      "folder_key": "9b6fa8e2c1404d57",
      "deleted_by": {
        "id": "92f1bcb2-4e69-4a02-8ae0-1e115cf1e0d3",
        "name": "示例用户"
      },
      "deleted_at": "2026-10-13T09:00:00.000Z",
      "expires_at": "2026-11-12T09:00:00.000Z",
      "can_restore": false
    }
  ],
  "total": 2,
  "limit": 50,
  "offset": 0
}
```

### 排序和展示范围

排序固定为 `deleted_at DESC, type ASC, key ASC`。分页发生在权限筛选之后，不支持自定义排序、关键词搜索或按类型筛选参数。

- 只返回尚未到期的回收记录。
- 文档只有被单独删除时才单独出现在列表中。
- 删除文件夹时，其原本正常的文档随文件夹隐藏，不额外生成文档列表项。
- 原文件夹也进入回收站后，已经单独删除的文档仍单独展示，`can_restore=false`。
- `can_restore` 是本次列表的状态提示，不是持续有效的操作授权。到期、权限变化或其他成员操作，都可能使下一次恢复请求失败。

## 移入回收站

### 文档

```http
DELETE /api/document/14c6e9a82b3f4d05
```

成功后文档从项目树、普通搜索、最近文件及普通读取入口中隐藏；正文和附件关联保留，分享访问暂时不可用。

前端删除按钮应使用“移入回收站”的语义。成功后刷新相关列表，并停止已打开文档的后续自动保存。

### 文件夹

```http
DELETE /api/folder/9b6fa8e2c1404d57
DELETE /api/folder/9b6fa8e2c1404d57?cascade=true
```

`cascade` 默认为 false，仅接受单个小写 `true` 或 `false`。

| 场景 | 结果 |
| --- | --- |
| 没有未删除的子项 | 默认请求即可成功 |
| 存在正常文档，cascade=false 或未传 | 409，提示确认一并移入回收站 |
| 存在正常文档，cascade=true | 文件夹与其正常内容一起隐藏 |
| 只剩已单独删除的文档 | 默认请求可将文件夹移入回收站，原文档删除时间保留 |

前端可以在明确展示“文件夹内内容将一并移入回收站”的确认操作后发送 `cascade=true`。不要把所有 409 都自动重试为级联删除。

### 项目删除的区别

`DELETE /api/project/:projectKey` 仍为彻底删除。有子项时需要 `cascade=true`，会删除项目内正常内容和回收站内容。

项目树看起来为空，但仍包含回收站中的文件夹时，`cascade=false` 也会返回 409。项目删除的确认提示必须覆盖回收站内容；不能承诺项目可在 Trash 中恢复。

## 恢复对象

```http
POST /api/trash/document/14c6e9a82b3f4d05/restore
POST /api/trash/folder/9b6fa8e2c1404d57/restore
```

路径参数 `type` 只接受小写 `document` 或 `folder`，`key` 使用列表项的 `key`。请求无需 body，成功返回：

```json
{ "success": true }
```

恢复规则：

- 对象必须仍在回收站中、尚未到期，且当前用户具有项目写权限。
- 文档恢复到原文件夹；原文件夹仍在回收站时返回 409“请先恢复原文件夹”。
- 文件夹恢复后，其原本正常的文档随之重新显示；此前单独删除的文档仍保留在回收站。
- 恢复沿用原 key、正文、附件关联、revision 和内容修改信息。未撤销的旧分享链接重新可用。
- 最近查看记录在回收站期间被隐藏；恢复后仍存在的记录可重新显示，恢复动作不会新增查看时间。
- 同名对象不会自动改名，接口不接受目标文件夹、目标项目或新名称参数。
- 重复恢复已正常的对象返回 409，已被彻底删除的对象返回 404。

当文档 `can_restore=false` 时，前端可禁用直接恢复并提示“请先恢复原文件夹”。也可提供单独的“恢复原文件夹”操作，使用该文档的 `folder_key` 调用文件夹恢复接口；成功后刷新列表，再处理文档恢复。

## 彻底删除对象

```http
DELETE /api/trash/document/14c6e9a82b3f4d05
DELETE /api/trash/folder/9b6fa8e2c1404d57
```

请求无需 body，成功返回 `{ "success": true }`。

- 对象必须处于回收站中；正常对象返回 409。
- 可以在 30 天到期之前手动彻底删除，无需等待到期。
- 删除文档会清理数据库中的文档、附件关联、分享和最近查看记录。
- 删除文件夹会清理其全部文档，包括此前单独进入回收站的文档。
- 过期但尚未清理的记录仍可按 key 手动彻底删除；已经清理的记录返回 404。
- 重复彻底删除返回 404，不保证重复请求都返回 success。
- R2 共享对象沿用现有保留策略，前端不要将此操作描述为“已释放多少存储空间”。

前端建议提供“彻底删除后无法恢复”的确认。文件夹确认同时说明内部文档也将被删除，可展示 `document_count`；该数量是列表快照，可能随其他操作变化。

## 保留期限和状态刷新

每次移入回收站都会产生新的 30 天保留期限。前端使用服务端返回的 `expires_at` 展示到期时间，不自行从本地操作时间推算。

达到到期时间后，对象从回收站列表中排除，恢复请求也会被拒绝。后台在服务启动时扫描一次，此后每小时扫描；停机或清理失败可能延后物理删除，因此 UI 不承诺到期瞬间完成物理清理。

| 操作成功后 | 前端刷新范围 |
| --- | --- |
| 文档移入回收站 | 所属项目树、文档搜索、最近文件、回收站；处理已打开的编辑器 |
| 文件夹移入回收站 | 同上，覆盖文件夹内文档 |
| 恢复文档 | 所属项目树、文档列表、最近文件、回收站 |
| 恢复文件夹 | 所属项目树和回收站整页，重新读取独立删除文档的 can_restore |
| 彻底删除文档 | 回收站；失效相关文档和最近文件缓存 |
| 彻底删除文件夹 | 回收站整页及关联项目缓存，移除失效的子文档缓存 |

列表交互建议：

- 切换团队、项目或每页数量时，将 offset 重置为 0。
- 对列表请求使用 AbortController 或请求序号，防止旧范围的响应覆盖新范围。
- 分别处理加载中、请求失败、空列表和正常列表；请求失败不显示成“回收站为空”。
- 操作期间禁用对应行的重复操作。成功后重新请求列表，不只在本地删除一行或把 total 减一。
- 文件夹恢复、彻底删除可能影响多行及其他分页的数据，尤其需要重新查询。
- 删除当前页最后一项后，若 items 为空且 offset 大于 0，可根据最新 total 回退到最后有效页，再查询一次。
- 404 或 409 后刷新当前范围，以服务端最新状态更新按钮。网络超时也可能发生在后端已完成操作之后，先刷新再决定是否重试。
- 名称、删除人姓名和错误消息按普通文本展示。

## 错误响应与处理

错误正文统一为：

```json
{ "error": "请先恢复原文件夹" }
```

没有独立的机器可读业务 code。按 HTTP 状态区分大类，使用 `error` 展示具体原因，不把全部 409 视为同一种业务冲突。

| HTTP 状态 | 典型原因或消息 | 前端处理 |
| --- | --- | --- |
| 400 | type 不合法、limit 不在 1～200、offset 为负、参数无法解析 | 检查请求参数并展示提示 |
| 401 | 请先登录；登录已过期或已失效 | 进入现有登录或会话刷新流程 |
| 403 | 请求来源不受信任 | 核对前端 Origin、代理及后端允许来源配置 |
| 404 | 文档或文件夹不存在；项目不存在或没有访问权限；团队不存在或尚未加入 | 刷新范围，不区分“已删除”与“失去权限” |
| 409 | 文档或文件夹不在回收站中 | 刷新列表，可能已被其他成员恢复 |
| 409 | 请先恢复原文件夹 | 提示先处理父文件夹 |
| 409 | 文档或文件夹已过保留期限，无法恢复 | 刷新列表并展示已到期 |
| 409 | 文件夹中有子项，请确认一并移入回收站 | 在文件夹软删除场景中展示级联确认 |
| 409 | 个人团队尚未初始化；工作区正在更新；资源关联已发生变化 | 展示具体消息，刷新或由用户稍后重试 |
| 500 | 服务器处理失败，请稍后重试 | 保留错误状态，提供重试入口 |

浏览器网络中断或 CORS 拦截可能没有 HTTP 状态和 JSON 正文，应通过请求层的网络错误分支处理。HEAD 请求没有正文，不能调用 `response.json()` 读取错误或成功结果。

## TypeScript 类型与请求封装

运行环境：TypeScript 5 及以上，编译配置包含 ES2020 和 DOM；运行时使用浏览器内置 Fetch API。下方两段代码可放在同一个 `trash-api.ts` 中，无第三方运行时依赖。

### 类型定义

```ts
export type TrashType = "document" | "folder";

interface TrashItemBase {
  key: string;
  name: string;
  team_key: string;
  project_key: string;
  deleted_by: { id: string; name: string } | null;
  deleted_at: string;
  expires_at: string;
  can_restore: boolean;
}

export type TrashItem =
  | (TrashItemBase & {
      type: "document";
      folder_key: string;
      document_count?: never;
    })
  | (TrashItemBase & {
      type: "folder";
      folder_key: null;
      document_count: number;
    });

export interface TrashListQuery {
  team_key?: string;
  project_key?: string;
  limit?: number;
  offset?: number;
}

export interface TrashListResponse {
  items: TrashItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface MutationResult {
  success: true;
}
```

### Fetch 封装

```ts
export class TrashApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "TrashApiError";
  }
}

interface TrashApiOptions {
  baseUrl?: string;
  getAccessToken?: () => string | undefined;
}

export function createTrashApi(options: TrashApiOptions = {}) {
  const baseUrl = (options.baseUrl ?? "/api").replace(/\/+$/, "");

  async function request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");

    const token = options.getAccessToken?.();
    if (token) {
      headers.set("Authorization", "Bearer " + token);
    }

    const response = await fetch(baseUrl + path, {
      ...init,
      credentials: "include",
      headers,
    });

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message =
        body !== null &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "请求失败（HTTP " + response.status + "）";

      throw new TrashApiError(response.status, message);
    }

    return response.json() as Promise<T>;
  }

  return {
    list(params: TrashListQuery = {}, signal?: AbortSignal) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          query.set(key, String(value));
        }
      }

      const suffix = query.toString();
      return request<TrashListResponse>(
        "/trash" + (suffix ? "?" + suffix : ""),
        { signal },
      );
    },

    restore(type: TrashType, key: string) {
      return request<MutationResult>(
        "/trash/" + type + "/" + encodeURIComponent(key) + "/restore",
        { method: "POST" },
      );
    },

    purge(type: TrashType, key: string) {
      return request<MutationResult>(
        "/trash/" + type + "/" + encodeURIComponent(key),
        { method: "DELETE" },
      );
    },

    moveDocumentToTrash(fileKey: string) {
      return request<MutationResult>(
        "/document/" + encodeURIComponent(fileKey),
        { method: "DELETE" },
      );
    },

    moveFolderToTrash(folderKey: string, cascade = false) {
      return request<MutationResult>(
        "/folder/" + encodeURIComponent(folderKey) + "?cascade=" + cascade,
        { method: "DELETE" },
      );
    },
  };
}
```

Cookie 登录场景使用 `createTrashApi()`；Bearer 场景通过 `getAccessToken` 读取现有认证状态中的当前令牌。跨源 API 地址通过 `baseUrl` 指定，并包含 `/api` 前缀。

封装让 HTTP 错误以 `TrashApiError` 抛出；网络失败、用户取消列表请求等保留 Fetch 原始异常。登录刷新、提示、确认弹窗和页面缓存失效由现有请求层或页面处理。封装不会自动重试恢复、彻底删除等写操作。

## 对照位置

| 内容 | 当前实现 |
| --- | --- |
| Trash 路由、参数解析 | [handler/trash.go](../../internal/handler/trash.go) |
| 项目权限筛选、恢复和彻底删除规则、响应字段 | [service/trash.go](../../internal/service/trash.go) |
| 列表合并、排序、到期条件 | [repository/trash.go](../../internal/repository/trash.go) |
| 文档和文件夹移入回收站、项目删除 | [service/workspace.go](../../internal/service/workspace.go) |
| 定时清理 | [service/trash_cleanup.go](../../internal/service/trash_cleanup.go) |

业务范围见[Trash 功能开发计划](trash.md)。前端对接时使用本文列出的当前响应字段和状态处理。
