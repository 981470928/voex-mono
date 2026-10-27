# Voex 登录与上传接口

状态：experimental。服务器 `192.140.173.58`，后端目录 `/home/server`，接口前缀 `/api`。本地前端入口为 `http://localhost:3000/test/login`，由 Vite 代理访问服务器。前端代码未上传到服务器。

## 账号与资料

账号为 8–64 个 Unicode codepoint，密码为 10–128 个 Unicode codepoint。中文、字母、数字、符号和空格均可使用；不裁剪账号/密码、不转换大小写、不进行 Unicode 归一化。数据库以字节精确比较账号，并使用唯一索引处理并发注册。密码强度提示不增加强制字符种类规则。

昵称去除首尾空白后为 1–64 个字符，必填。头像、邮箱、手机号选填。邮箱最多 254 个字符；手机号为 5–32 个字符，允许数字、空格、括号、短横线和开头的 `+`。邮箱和手机号目前仅作为资料保存，不代表已验证，不参与登录或找回密码。

```ts
interface User {
  id: string;
  account: string;
  name: string;
  avator: string;
  email: string;
  phone: string;
}

interface Session {
  accessToken: string;
  expiresIn: 900;
  user: User;
}

interface Creator {
  id: string;
  name: string;
  avator: string;
}
```

## 认证接口

```text
POST /api/auth/account-availability
Body: { account }
Response: { available: boolean }

POST /api/auth/register
Body: { account, password, name, email?, phone? }
Response: Session，HTTP 201

POST /api/auth/login
Body: { account, password }
Response: Session

POST /api/auth/refresh
Cookie: voex_refresh
Response: Session

POST /api/auth/logout
Cookie: voex_refresh，或 Authorization: Bearer <accessToken>
Response: { success: true }

GET /api/auth/me
Response: User

PATCH /api/auth/me
Body: { name?, email?, phone?, avator? }
Response: User
```

注册、创建个人团队与创建会话在同一事务中提交。注册成功后已经登录，且拥有唯一的个人团队；头像先在浏览器选择，再使用会话上传，然后更新 `avator`。头像上传失败只重试上传，不再次注册账号。团队规则见 [TEAM-API.md](/C:/Users/WS/Desktop/myself/voex-main/TEAM-API.md)。

access JWT 使用 HS256，校验固定算法、签名、issuer、audience、有效期、用户与会话关联。有效期 900 秒。密钥在服务器 `.secrets/jwt-key` 中生成并持久化，权限为 0600。密码使用 Argon2id：memoryCost=19456 KiB、timeCost=2、parallelism=1。

refresh token 为 32 字节随机值，数据库只存 SHA-256 哈希，固定有效期 7 天；不会因续期延长，也不在当前版本轮换。refresh cookie 为 HttpOnly、SameSite=Strict，路径 `/api/auth`。access cookie 用于本人私有头像等资源，路径 `/api`，同样 HttpOnly。前端 access token 仅存内存。

每次受保护请求同时检查数据库会话，注销后旧 access JWT 立即失效。浏览器刷新通过 refresh cookie 恢复登录；会话失效时保留当前编辑器并弹出同账号重新登录表单。

错误响应统一为 `{ "error": "中文说明" }`。参数错误为 400，未登录或会话失效为 401，非法请求来源为 403，无访问权限的文件按不存在返回 404，账号冲突为 409，上传过大为 413，频率限制为 429。

## 文件与创建者

项目、文档与文档附件按团队成员关系和项目授权访问，文件额外支持独立只读/编辑分享链接；`creator` 保留创建者身份，不再决定这些资源的全部访问权限。团队所有者和管理员可编辑全部项目，普通成员按项目继承或指定名单取得权限。完整规则与接口见 [TEAM-API.md](/C:/Users/WS/Desktop/myself/voex-main/TEAM-API.md)。

文档创建/列表/详情、项目树中的文档、附件列表与上传结果返回 `creator`。`id` 永久关联用户；`name` 和 `avator` 使用该创建者的当前资料。服务器忽略客户端伪造的 `creator`。独立上传资源保留创建者访问控制，当前头像另向同团队成员开放；文件分享通过专用接口读取创建者头像。

现有 `/api/upload` 是文档附件上传，要求 JWT 和目标文件的项目编辑权限，继续使用 `fileKey`、`file`、可选 `file_name` 和 `mime`，返回 `{ hash, creator }`。文件分享 token 不能调用此接口或独立上传接口。附件正文仍存 `/home/static`。删除只清除数据库关联，物理内容保留，防止与并发上传的去重 hash 发生竞争；当前未配置孤立文件定时清理。

## 独立上传接口

```text
POST /api/assets/upload
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

file: 一个文件
path: 相对目录，例如 avator、thumbnail、documents/images
```

```json
{
  "id": "服务器生成的 UUID",
  "name": "原文件名.png",
  "url": "/api/assets/服务器生成的 UUID",
  "path": "avator",
  "size": 1024,
  "mime": "image/webp",
  "creator": { "id": "用户 UUID", "name": "昵称", "avator": "" }
}
```

成功返回 HTTP 201。读取返回的 `url` 需要有效会话，默认仅文件创建者可读；用户当前使用的头像也可由同团队成员读取。持文件分享链接者使用 `/api/shared-file/creator-avator` 与 `X-Share-Token` 读取该文件创建者的当前头像，不获得其他独立上传资源的权限。

`path=avator` 保存到 `/home/update/avator`，`path=thumbnail` 保存到 `/home/update/thumbnail`。缺失目录自动创建。每段目录允许 1–64 个 ASCII 字母、数字、短横线或下划线，整条路径最多 255 个字符，可用 `/` 分层。拒绝绝对路径、`.`、`..`、反斜线、编码路径与符号链接。文件名使用服务器 UUID，不能覆盖已有文件。

通用上传最大 200 MiB；头像最大 5 MiB；缩略图最大 20 MiB。头像和缩略图只接收有效的静态 JPEG、PNG、WebP，最多 2000 万像素。服务器解码、去除 metadata、转换为 WebP，头像限制在 512×512，缩略图限制在 1920×1920。其他路径的文件以 attachment / application/octet-stream 提供。

```bash
curl --fail-with-body --request POST 'http://192.140.173.58/api/assets/upload' \
  --header "Authorization: Bearer ${TOKEN}" \
  --form 'path=avator' \
  --form 'file=@/absolute/path/avatar.png'
```

## 登录阶段迁移与验证（历史记录）

以下为 `002-auth` 登录阶段的迁移与验收记录。该阶段的“跨账号隔离”已被后续团队授权扩展；当前权限与最新验收范围以 [TEAM-API.md](/C:/Users/WS/Desktop/myself/voex-main/TEAM-API.md) 为准。

账号 `981470928`、昵称「陈睿」已创建。现有 2 个项目、4 个文档、3 个附件已归属该账号。密码不记录在本文档。

服务器修改通过 SSH 完成。源码与迁移前数据库备份保留在服务器 `releases/auth-before-*`，当前备份位置记录在 `/home/server/.auth-backup-path`。迁移为 `002-auth`；不删除旧文档或附件。

40 项真实接口检查已通过，包括跨账号项目/文件/附件隔离、头像和缩略图上传、路径穿越拒绝、签名篡改、过期 JWT、refresh、注销立即生效和失败上传清理。12 项浏览器流程已验证，包括 390px 布局、注册、资料编辑、刷新恢复登录、注销，以及会话失效保留正文并在重新登录后继续自动保存。检查记录位于服务器备份目录 `api-verification.json` 与 `browser-verification.json`；临时验收账号和文件均已清理。前端通过 TypeScript、改动文件 ESLint、Vite build 和 strict UI audit；全项目 ESLint 尚有 `RecentPage.vue` 中两个既有未使用变量。未生成或运行单元测试。

当前服务器只配置 HTTP，HTTPS 尚未配置。cookie 的 Secure 属性在 HTTPS 请求时启用；公网正式使用前需要配置 TLS。后端仅监听 `127.0.0.1:8090`，由 Nginx 转发。受信 Origin 可通过 `AUTH_ALLOWED_ORIGINS` 以逗号分隔配置，默认包含当前服务器 HTTP 地址和本地 3000/3001 端口。

依据：[JWT RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html)、[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Multer 官方文档](https://expressjs.com/en/resources/middleware/multer/)。
