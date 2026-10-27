# Voex

Voex 的前端（Vue 3 + TypeScript）、Go API 和多人协同服务源码统一存放在此仓库。项目提供两条互相独立的启动路径：

| 场景 | 适合谁 | 需要的环境 | 命令 |
| --- | --- | --- | --- |
| [本地启动](#一本地启动源码) | 修改前端/后端源码 | Node.js、pnpm、Go、MySQL | `setup.mjs` → `dev.mjs` |
| [快速部署体验](#二快速部署体验预置包) | 下载后直接体验或部署 | Node.js、MySQL | 填写配置 → `start.mjs` |

两种方式共用根目录的 `voex.config.json` 和同一套运行配置。配置只写在本地，不进入 Git。

## 一、本地启动（源码）

### 1. 准备环境

- Node.js 22.18+（22.x）或 24.12+，以及 pnpm（Node 自带的 corepack 也可：`corepack enable pnpm`）。
- Go 1.27.1（以 [`server/go.mod`](server/go.mod) 为准）。
- MySQL 8，数据库已创建并导入表结构（空库执行一次）：

  ```sh
  mysql -u<用户> -p <数据库名> < server/internal/database/schema.sql
  ```

  不要向已有业务库重复导入 schema；已有库请按 [数据库说明](server/docs/db.md) 显式迁移。

### 2. 填写配置

```sh
cp voex.config.example.json voex.config.json
```

编辑 `voex.config.json`，至少填写 `database` 下的地址、用户名、密码和库名。字段说明见[配置](#配置)。也可以直接运行第 3 步，首次运行会在交互终端中询问配置。

### 3. 读取配置并写入运行文件

```sh
node scripts/setup.mjs
```

脚本会校验配置和数据库端口可达性，生成：

- `.voex/runtime/server.env`：由 `voex.config.json` 转换出的运行配置；
- `.voex/secrets/`：JWT、分享链接和协同服务的签名密钥（已存在时不会覆盖）；
- `.voex/data/`：本地上传文件存储目录。

### 4. 一键启动前后端

```sh
node scripts/dev.mjs
```

脚本会自动完成：

1. 检查 Node.js、Go、pnpm 和 MySQL；
2. 按 lockfile 安装 `web/`（及启用时 `server/collab/`）依赖；
3. 下载固定版本 MathJax 到 `web/public/vendor/`；
4. 编译 Go API 到 `.voex/build/voex-server` 并执行数据库/表结构检查；
5. 同时启动 Vite 前端和 Go API，等待两者就绪。

访问 `http://127.0.0.1:3500/app/`。前端由 Vite 提供热更新，`/api` 请求代理到 `http://127.0.0.1:8080`；按 Ctrl+C 同时停止两个进程。

- 前端端口可用 `VOEX_DEV_PORT` 修改，默认 `3500`。
- 后端监听地址/端口取自 `voex.config.json` 的 `host` / `port`。
- 只检查环境、安装依赖和编译，不启动服务：`node scripts/dev.mjs --check`。
- 修改 Go 代码后需重新执行 `node scripts/dev.mjs`。

## 二、快速部署体验（预置包）

仓库中的 [`prebuilt/`](prebuilt/) 已提前打包前端、Go 服务和协同服务，并提交到 Git。下载仓库后不需要安装 Go、pnpm，也不需要重新构建，**只需填写配置并执行一条启动命令**。

### 1. 准备环境

- Node.js 22.18+（22.x）或 24.12+（仅用于运行脚本和协同服务）。
- MySQL 8，数据库已创建并导入表结构：

  ```sh
  mysql -u<用户> -p <数据库名> < server/internal/database/schema.sql
  ```

- 支持 Windows / Linux 的 x64、arm64。其他平台请使用本地启动。

### 2. 填写配置

```sh
cp voex.config.example.json voex.config.json
```

编辑数据库连接等字段。Pexels Key、端口和协同开关都在运行时读取，修改后不需要重新打包。

### 3. 一键启动

```sh
node scripts/start.mjs
```

脚本会：

1. 校验 `prebuilt/` 清单、前端和协同服务的内容摘要；
2. 读取配置，生成 `.voex/runtime/server.env` 和签名密钥；
3. 解压当前平台的 Go 服务到 `.voex/prebuilt/`；
4. 执行数据库账号、表结构和存储目录检查；
5. 启动 Go API；前端和 API 共用一个 HTTP 端口，按需启动协同服务。

默认访问 `http://127.0.0.1:8080/app/`，Ctrl+C 停止。只检查不启动：`node scripts/start.mjs --check`。

预置包覆盖 `linux-amd64`、`linux-arm64`、`windows-amd64`、`windows-arm64`。当前平台不在清单中时，脚本会明确提示改用本地启动。

## 配置

`voex.config.json` 由 Git 忽略，可从 [`voex.config.example.json`](voex.config.example.json) 复制。JSON 不允许注释和末尾多余逗号。

| 参数 | 要求及默认值 |
| --- | --- |
| `host` | HTTP 监听地址，默认 `127.0.0.1`；允许局域网访问时可设 `0.0.0.0` |
| `port` | HTTP 端口，默认 `8080`，必须为 1–65535 的整数且未被占用 |
| `database.host` | 必填，MySQL 主机名或 IP，不含协议和端口 |
| `database.port` | 默认 `3306` |
| `database.user` | 必填，数据库用户名 |
| `database.password` | 数据库密码；确实无密码的账号允许空字符串 |
| `database.name` | 必填，已存在且完成初始化的数据库名称 |
| `pexelsKey` | 可选，空字符串表示图库不可用；通过 `/api/public/config` 在运行时提供给前端 |
| `collaboration` | 默认 `false`，按需启用多人协同 |
| `collaborationPort` | 协同内部端口，默认 `8091`，启用时不可与 HTTP 端口相同 |
| `publicUrl` | 启用协同时必填，浏览器实际访问的 origin，如 `http://localhost:8080`；不能带 `/app/` 等路径 |

HTTP 端口和数据库端口是两个不同参数。脚本不会安装或启动 MySQL，也不会修改已有数据库。启用协同前还需满足 [协同说明](server/docs/COLLABORATION.md) 中的数据结构要求。

## 维护预置包

预置包由维护者在具备完整工具链的机器上生成：

```sh
node scripts/package.mjs
```

该命令会重新构建 `prebuilt/web/`、四个平台的 Go 服务（gzip 压缩）和 `prebuilt/collab/`，并写入 `prebuilt/MANIFEST.json`。完成后提交 `prebuilt/` 即可发布。不要手工修改预置产物。

## 目录

| 目录 | 内容 |
| --- | --- |
| `web/` | Vue + TypeScript 前端，包含共享编辑器 schema |
| `server/` | Go API、数据库初始化 SQL、服务文档与部署示例 |
| `server/collab/` | 可选的 Node/Hocuspocus 多人协同服务 |
| `prebuilt/` | 提交到 Git 的前端、Go 服务和协同服务预置产物及清单 |
| `scripts/` | 配置、本地启动、快速部署和打包脚本 |
| `docs/` | 本机启动与部署说明 |

运行期生成且被 Git 忽略的目录：

| 路径 | 内容 |
| --- | --- |
| `voex.config.json` | 本机配置，含数据库密码及可选 Key |
| `.voex/runtime/server.env` | 由配置生成的运行环境文件 |
| `.voex/runtime/state.json` | 初始化标记，用于避免自动重建已丢失的签名密钥 |
| `.voex/secrets/` | 自动生成的稳定签名密钥；备份后可在新环境复用 |
| `.voex/data/` | 本机上传文件及资产存储 |
| `.voex/prebuilt/` | 快速部署时解压出的当前平台 Go 服务 |
| `.voex/build/` | 本地启动时编译的 Go 服务 |
| `.voex/cache/` | 固定版本 MathJax 资源及本地 Go 构建缓存 |
| `web/public/vendor/` | 本地启动使用的 MathJax 静态资源 |

## 多人协同（可选）

在 `voex.config.json` 中设置 `collaboration: true`，填写 `publicUrl`，并确认 `server/docs/COLLABORATION.md` 中的数据库迁移已执行。

- 本地启动会自动安装并构建 `server/collab/`，随后与前端、Go API 一起启动。
- 快速部署直接使用 `prebuilt/collab/`，不读取前端源码。
- 协同进程只监听 `127.0.0.1:collaborationPort`，浏览器通过 Go API 的 `/api/collab/ws` 访问；停止时先排空未落库编辑，再依次停止协同服务和 Go API。

## 独立部署

两条启动命令都是前台进程，不注册开机服务，也不修改现有 Nginx、PM2 或 systemd 配置。生产环境可以继续使用原有的独立构建与部署方式：

- 前端发布 `web/dist/`（默认资源路径 `/app/`，`build:test` 为 `/test/`）；
- Go API 发布 `server/bin/voex-server`；
- 协同服务按需单独部署。

详细参数、目录和常见问题见 [部署文档](docs/deployment.md)。子目录原文档中的 `/home/voex`、`/home/voex-server` 记录了原部署布局；从新目录部署时须按实际路径调整。

## 许可证

沿用 [PolyForm Noncommercial License 1.0.0](LICENSE)，许可证内容未修改；`web/LICENSE` 与 `server/LICENSE` 同样保留。授权范围以许可证原文为准。
