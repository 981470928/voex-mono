# Voex 团队、项目权限与文件分享接口

状态：experimental。后端位于服务器 `192.140.173.58:/home/server`，本次通过 SSH 修改并生效；前端在本地完成，未上传服务器。接口统一以 `/api` 开头。账号、JWT、资料和独立上传的基础合同见 [AUTH-API.md](/C:/Users/WS/Desktop/myself/voex-main/AUTH-API.md)。

## 1. 业务规则

用户身份独立，同一用户可加入多个团队，并在不同团队分别担任 `owner`、`admin`、`member`。每个用户恰有一个个人团队；注册时与用户、会话在同一事务创建，已有用户由 `003-teams` 迁移补齐。本人固定为个人团队所有者。个人团队可以邀请成员、创建项目；禁止删除、转让和所有者退出。

资源结构固定为 `团队 → 项目 → 文件夹 → 文件`。项目根目录只能有文件夹，文件夹仅一层，文件只能属于文件夹。文件创建者保留为 `creator: { id, name, avator }`，不再作为项目和文件访问权限的唯一依据。

团队所有者和管理员拥有团队内全部项目的编辑权限，并负责入队审核和项目授权。所有团队成员可创建项目；普通成员必须拥有目标项目的编辑权限，才能浏览目录、创建文件夹或文件，以及编辑项目中的内容。新建项目继承团队权限，并创建一个默认文件夹。

项目成员可生成只读或编辑文件链接。持有效链接者无需登录，即可读取指定文件及其附件；编辑链接允许修改该文件正文，不授予项目目录、创建资源、附件上传、删除文件或再次生成分享链接的权限。已登录用户的项目编辑权限优先于只读链接。

普通成员只能撤销自己创建的分享；所有者和管理员可以撤销该团队项目中的任意分享。成员退出或被移除后失去团队和项目权限，其已创建的文件分享独立保留，直到链接撤销或文件删除。

## 2. privileges 与 permissions

`privileges` 描述资源配置，`permissions` 描述服务器为当前请求计算出的有效能力。前端使用后者控制入口，服务器对每次读取与写入重新授权。

```text
团队 privileges:    { mode: "members" }
项目 privileges:    { mode: "inherit" } | { mode: "restricted" }
文件夹 privileges:  { mode: "inherit" }
文件 privileges:    { mode: "inherit" }

项目/文件 permissions:
{ read: boolean, write: boolean, manage: boolean, share: boolean }

团队 permissions:
{ read: boolean, write: boolean, manage: boolean,
  transfer: boolean, delete: boolean }
```

团队、项目、文件夹的内容权限只有编辑或无权限；编辑时 `read`、`write` 都为 `true`。团队 `write` 表示内容能力，不代表普通成员能管理团队；团队改名、审核、邀请和项目授权要求管理身份。`transfer` 和 `delete` 只在当前用户为普通团队所有者时为 `true`，删除还要求团队无项目。

项目 `inherit` 使当前团队所有成员获得编辑权限；`restricted` 仅向指定的当前团队成员授权。`restricted` 加空名单不向普通成员开放；所有者、管理员始终保留编辑和管理权限。恢复 `inherit` 会清除显式项目成员名单。成员退出或被移除时，服务器同时清理其在该团队的显式项目授权。

文件夹权限强制继承项目，暂不提供修改入口或独立授权 API。文件的 `privileges.mode` 仍为 `inherit`，独立的 `read`/`edit` 分享记录由分享 API 管理。

```text
项目 edit + 有效 read 链接 → 文件 edit
无项目权限 + 有效 edit 链接 → 文件 edit
无项目权限 + 有效 read 链接 → 文件 read
无项目权限且无有效链接 → 拒绝访问
```

公共分享接口固定返回 `manage: false, share: false`。即使调用者拥有项目编辑权限，调用公共接口也必须提供有效链接；正常的登录文件接口独立使用 JWT 和项目权限。

## 3. 团队与成员

本节接口均要求有效登录会话。团队编号 `team_code` 为 10 位数字；`team_key` 为服务器生成的资源标识，不能用编号代替。团队名称去除首尾空白后为 1–128 个 Unicode codepoint。

```text
Team = {
  team_key, team_code, name,
  kind: "personal" | "standard",
  role: "owner" | "admin" | "member",
  owner_id, member_count, created_at,
  privileges: { mode: "members" }, permissions
}

TeamMember = {
  user_id, name, avator,
  role: "owner" | "admin" | "member", joined_at
}

GET /api/teams
Response: Team[]，仅包含当前用户已加入的团队，本人的个人团队优先

POST /api/teams
Body: { name }
Response: Team，HTTP 201；创建普通团队，当前用户为 owner

GET /api/teams/:teamKey
Response: Team；要求该团队成员

PATCH /api/teams/:teamKey
Body: { name }
Response: Team；要求 owner/admin

DELETE /api/teams/:teamKey
Response: { success: true }；仅普通团队 owner，团队仍有项目时返回 409

POST /api/teams/:teamKey/transfer
Body: { user_id }
Response: { success: true }；仅普通团队 owner

GET /api/teams/:teamKey/members
Response: TeamMember[]；要求该团队成员

PATCH /api/teams/:teamKey/members/:userId
Body: { role: "admin" | "member" }
Response: { success: true }；仅 owner

DELETE /api/teams/:teamKey/members/:userId
Response: { success: true }
```

转让目标必须为本团队其他现有成员；原所有者转为管理员。修改角色不能直接设置 `owner`，也不能修改当前所有者的身份。管理员只能移除普通成员；所有者可以移除管理员或普通成员。成员可以使用 `:userId=me` 退出，但所有者不能退出或被移除。成员列表只返回展示资料，不返回账号、邮箱、手机号。

## 4. 邀请与申请审核

邀请链接与团队编号都只用于发起申请，不直接入队。浏览器邀请地址为 `/test/join#<token>`，创建页面根据当前运行的前端 base 生成完整地址。原始邀请 token 仅在创建响应中返回一次，数据库保存 SHA-256 hash；列表不返回 token。登录跳转中凭证保留在 fragment，不放入 query。

```text
Invite = { id, created_at, revoked_at: string | null }
JoinRequest = {
  id, team_key, team_name, user_id, name, message,
  status: "pending" | "approved" | "rejected",
  created_at, reviewed_at: string | null
}

GET /api/teams/:teamKey/invites
Response: Invite[]；要求 owner/admin

POST /api/teams/:teamKey/invites
Response: { id, token, created_at }，HTTP 201；要求 owner/admin

DELETE /api/teams/:teamKey/invites/:inviteId
Response: { success: true }；要求 owner/admin

POST /api/team-invites/inspect
Body: { token }
Response: { team_key, team_code, name, kind }；无需登录

POST /api/team-join-requests
Body: { team_code, message } 或 { invite_token, message }
Response: JoinRequest；要求登录，尚未加入目标团队

GET /api/team-join-requests
Response: JoinRequest[]；当前用户的申请

GET /api/teams/:teamKey/join-requests
Response: JoinRequest[]；要求 owner/admin

PATCH /api/teams/:teamKey/join-requests/:requestId
Body: { status: "approved" | "rejected" }
Response: JoinRequest；要求 owner/admin
```

申请信息去除首尾空白后必填，接受 1–1000 个 Unicode codepoint。同一用户对同一团队重复提交 pending 申请时返回原申请，不重复创建；已拒绝，或已通过后又退出/被移除的用户再次申请时，生成新的申请 ID。旧审核请求不能批准新一轮申请。

批准后创建 `member` 关系。同一审批结果重复提交幂等；对已处理申请提交相反结果返回 409。邀请撤销阻止后续通过该链接提交申请，不移除已加入成员，也不取消已提交申请。编号申请仍可独立使用。

## 5. 项目、文件夹与项目授权

本节接口均要求 JWT。省略 `team_key` 时选择本人的个人团队；传入该字段时必须为团队成员。项目列表只返回有权限的项目；项目编辑权限不能授予团队以外的人。

```text
Project = {
  project_key, team_key, name, created_at, updated_at,
  privileges: { mode: "inherit" | "restricted" }, permissions
}
Folder = {
  folder_key, project_key, parent_key: null,
  name, created_at, updated_at, privileges: { mode: "inherit" }
}

GET /api/projects?team_key=<teamKey>
Response: Project[]

POST /api/workspace/initialize
Body: { team_key? }
Response: Project[]；读取当前团队可见项目，不额外创建项目

POST /api/project
Body: { name, team_key? }
Response: Project；所有团队成员可创建

GET /api/project/:projectKey/tree
Response: { project: Project, folders: Folder[], documents: DocumentSummary[] }

PUT /api/project/:projectKey
Body: { name }
Response: { success: true }；要求项目编辑权限

DELETE /api/project/:projectKey
Query: cascade?: "true" | "false"（默认 false）
Response: { success: true }；要求项目编辑权限，空项目直接删除；有子项且未确认时返回 409，确认后 cascade=true 连带删除全部子项

POST /api/folder
Body: { project_key, name, parent_key?: null }
Response: Folder；要求项目编辑权限，非空 parent_key 返回 400

PUT /api/folder/:folderKey
Body: { name }
Response: { success: true }；要求项目编辑权限

DELETE /api/folder/:folderKey
Query: cascade?: "true" | "false"（默认 false）
Response: { success: true }；要求项目编辑权限，空文件夹直接删除；有子项且未确认时返回 409，确认后 cascade=true 连带删除全部后代

GET /api/project/:projectKey/privileges
Response: { mode: "inherit" | "restricted", user_ids: string[] }

PUT /api/project/:projectKey/privileges
Body: { mode: "inherit" | "restricted", user_ids: string[] }
Response: Project，privileges 额外包含 user_ids
```

项目授权的 GET/PUT 均要求该团队 owner/admin。`user_ids` 必填，最多 1000 项，服务器去重并核对全部用户属于目标团队；`inherit` 请求使用空数组，返回空数组。`restricted` 的名单与模式在同一事务更新。权限变更与资源写操作共用 workspace 行锁，写入前在事务内重新检查权限，避免移除权限后继续用旧检查结果写入。

项目、文件夹删除的权限校验、子项检查与级联删除均在同一工作区写锁事务内执行。有子项但未传 `cascade=true` 时返回 409，不修改数据；前端据此显示确认，不依赖可能过期的目录缓存。`cascade` 仅接受单个小写 `true` 或 `false`，重复、数组、空值或其他值返回 400。级联范围包含全部后代文件夹、文档、附件关联、分享链接与最近访问记录，删除项目同时清除项目成员记录；任一步失败则全部回滚。共享 R2 哈希对象保留，避免误删其他文档复用的附件内容。本次实现位于本地 Go 服务端项目 `C:/Users/WS/Desktop/voex-server-main`，不涉及上传或部署。

## 6. 文件正文与 revision

```text
DocumentSummary = {
  id, file_key, file_name, project_key, folder_key,
  created_at, updated_at, creator: { id, name, avator },
  privileges: { mode: "inherit" }, revision: number
}

POST /api/document
Body: { file_name?, team_key?, project_key?, folder_key? }
Response: {
  file_key, file_name, project_key, folder_key, project_name,
  folder_path, creator, privileges: { mode: "inherit" }, revision: 1
}

GET /api/document/:fileKey
Response: DocumentSummary + { file_content: string | null, permissions }

GET /api/documents?code=<文件名关键词>
Response: DocumentSummary[]；当前用户全部团队中有项目权限的文件

PUT /api/document/:fileKey
Body: { file_name?, file_content?: string | null, revision?: number }
Response: { success: true, revision: number }

DELETE /api/document/:fileKey
Response: { success: true }；同时移除附件关联和分享记录
```

以上接口均使用 JWT 和项目编辑权限。创建时显式提供目标文件夹；服务器会校验文件夹、项目与团队一致。省略文件夹时使用目标项目的默认根文件夹；省略项目时选择目标团队第一个可见项目，没有可见项目时创建默认项目。文件始终位于文件夹内。

`revision` 从 1 开始。提交正文时必须携带最近读取的整数版本号，每次成功写入后加 1；旧版本返回 HTTP 409，正文保持原值。仅修改文件名时不要求版本号，也不增加正文版本。公共编辑与登录编辑共用同一 revision，能检测双方的并发覆盖。

前端遇到 409 保留本地正文并停止继续覆盖保存；重新加载前要求确认，取消保留本地内容，确认后读取服务器最新版。接口不会自动合并内容。

## 7. 文件分享管理与公开访问

分享管理接口要求 JWT，且调用者必须拥有文件所属项目的编辑权限。原始分享 token 为 32 字节随机值的 base64url 编码，共 43 个字符，仅创建响应返回一次；数据库保存 SHA-256 hash。邀请 token 与文件分享 token 使用不同记录和接口，不可互换。

```text
GET /api/document/:fileKey/shares
Response: [{
  id, permission: "read" | "edit", created_at, revoked_at,
  created_by: { id, name, avator }, can_revoke: boolean
}]

POST /api/document/:fileKey/shares
Body: { permission: "read" | "edit" }
Response: { id, token, permission, created_at }，HTTP 201

DELETE /api/document/:fileKey/shares/:shareId
Response: { success: true }
```

文件链接形如 `/test/share#<token>`。token 位于 URL fragment，浏览器不会把它随页面 HTTP URL 或 Referer 发给服务器。前端从 fragment 取出后，通过 `X-Share-Token` 请求头调用公开文件接口。不要把 token 放入 query、API 路径或日志。以下接口无需 JWT，可同时带 JWT 以计算项目编辑权限；无 token、无效 token 或已撤销 token 均返回 404。

```text
GET /api/shared-file
Header: X-Share-Token: <token>
Response: {
  file_key, file_name, file_content: string, created_at, updated_at,
  revision, privileges: { mode: "inherit" },
  permissions: { read: true, write: boolean, manage: false, share: false },
  creator: { id, name, avator },
  attachments: [{ hash, name, mime, creator: { id, name, avator: "" } }]
}

GET /api/shared-file/attachments/:hash
Header: X-Share-Token: <token>
Response: 附件二进制，Content-Disposition: attachment

GET /api/shared-file/creator-avator
Header: X-Share-Token: <token>
Response: 当前文件创建者的 WebP 头像；无头像返回 404
```

公开响应不暴露父团队、项目、文件夹标识或成员联系方式。头像字段非空时返回 `/api/shared-file/creator-avator`，读取也需同一分享请求头。附件下载必须同时匹配分享文件和指定 hash，不能用其他文件的 hash 获取内容。

公开分享接口不提供 PUT 写入。正文保存使用 `PUT /api/document/:fileKey`，需要有效登录身份、账号文件 write 权限和 revision；不能仅用 X-Share-Token 修改文件。公开读取响应设置 `Cache-Control: no-store` 和 `Referrer-Policy: no-referrer`，每次读取检查链接是否撤销。撤销阻止继续通过该链接访问，但不收回已授予账号的文件权限。

## 8. 上传与错误响应

`POST /api/assets/upload` 继续要求 JWT，按 `path` 保存到 `/home/update` 下的目录，目录规则与容量限制见 [AUTH-API.md](/C:/Users/WS/Desktop/myself/voex-main/AUTH-API.md)。文件分享 token 不能调用此接口。

文档附件上传 `POST /api/upload` 也要求 JWT 及目标文件的编辑权限，multipart 字段仍为 `fileKey`、`file`、可选 `file_name`、`mime`，返回 `{ hash, creator }`，正文存储在 `/home/static`。普通的附件列表、下载和删除接口跟随文件的账号权限；公开附件下载使用上一节专用接口。

独立资源默认仅创建者可读。当前用户头像可由同团队成员读取；文件分享仅开放该文件创建者当前头像的专用读取接口，不开放任意独立资源。

错误格式统一为 `{ "error": "中文说明" }`。400 表示参数或层级结构错误；401 表示受保护接口缺少有效登录；403 表示角色或分享权限不足；404 用于无资源访问权、无效链接、已撤销链接或资源不存在；409 用于已是成员、审批冲突、非空资源删除或正文版本冲突；413 表示正文/上传超过限制；429 表示频率限制。公开文件接口按 IP 每分钟最多 180 次，邀请检查与申请接口各按 IP 每分钟最多 60 次。

## 9. 迁移、验证与运行边界

迁移 `003-teams` 已执行。原有 2 个项目、4 个文档保留，项目归属其原创建者的个人团队；创建者记录不改。迁移先检查嵌套文件夹，发现嵌套时拒绝执行；当前数据满足单层结构。服务器备份路径记录在 `/home/server/.team-backup-path`，对应目录中的 `team-api-verification.json` 记录本次 108 项真实 API 检查结果。

前端 typecheck、改动文件 ESLint、build 和 strict UI audit 已通过，最终审计记录为 `.tmp/team-final-audit.json`，0 findings。全项目 ESLint 仍有 `RecentPage.vue` 的两个既有未使用变量错误。

已完成 18 项浏览器流程检查，包括匿名只读/编辑、附件预览、409 保留正文和取消/确认重载、撤销失效、个人/团队切换、390px 无横向溢出、创建团队、编号申请与审批后成员可见、restricted 空名单阻断普通成员访问、单层文件夹入口、分享创建/撤销、项目正文自动保存和编辑器返回时保留团队上下文。补充的 6 项检查覆盖申请长度 500/1000/1001、重新申请编号、业务时间和浏览器自动保存落库。

邀请链接接口已通过独立检查；自动打开邀请地址被浏览器 URL 策略拒绝，未绕过，因此不将邀请链接登录跳转列为已完成的浏览器验证。临时验收账号、团队、文件、附件和分享链接已清理；实施期间产生的其他数据保留。服务器备份目录的 `team-final-verification.json` 记录具体检查与清理结果。未生成或运行单元测试。

当前服务器仅配置 HTTP；HTTPS 尚未配置，沿用 [AUTH-API.md](/C:/Users/WS/Desktop/myself/voex-main/AUTH-API.md) 的运行限制。前端生产文件未上传；本地开发入口为 [团队页面](http://localhost:3000/test/home/teams)。

旧的分享正文写入入口已移除。分享页面和分享 API 只读；登录用户通过账号文件权限在普通 document 接口保存。历史匿名编辑验证记录仅描述旧版本，不代表当前支持匿名写入。
