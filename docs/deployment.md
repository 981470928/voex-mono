# 本机启动与部署

Voex 提供两条启动路径，命令均从仓库根目录执行，Windows PowerShell、Windows 命令提示符、Linux 和 macOS 终端一致。

| 路径 | 使用场景 | 需要 | 命令 |
| --- | --- | --- | --- |
| 本地启动 | 修改源码、开发调试 | Node.js、pnpm、Go、MySQL | `node scripts/setup.mjs` 后 `node scripts/dev.mjs` |
| 快速部署体验 | 直接运行仓库内已打包产物 | Node.js、MySQL | 填写配置后 `node scripts/start.mjs` |

## 环境要求

- 两种方式都支持 Windows / Linux / macOS 的 x64、arm64；macOS 覆盖 Intel Mac 和 Apple Silicon。
- Node.js 22.18+（22.x）或 24.12+。
- 已启动的 MySQL 8。正常启动自动创建缺失数据库和表；账号需具备相应的 `CREATE` / `REFERENCES` 权限。已有表的列结构仍由显式迁移维护。
- 本地启动额外需要 Go（版本见 `server/go.mod`）和 pnpm；pnpm 也可使用 Node 自带的 corepack。
- 快速部署不需要 Go、pnpm、Nginx 或全局进程管理器。

无需先手动建库或导入 SQL。`node scripts/dev.mjs` 和 `node scripts/start.mjs` 在正常启动前执行 Go 的 `init-db`：数据库不存在时创建数据库，按外键顺序补齐缺表，并幂等补上 `workspace_state.id=1`。重复或并发执行可恢复中断的初始化；已有表和记录保留。

`--check` 及 Go 的 `check-config` 只检查数据库，不触发建库、建表或补记录。已有表缺列或结构不兼容时，仍须按对应迁移文件处理。

## 一、本地启动（源码）

### 1. 填写配置

```sh
cp voex.config.example.json voex.config.json
```

编辑数据库、端口等字段。`voex.config.json` 已被 Git 忽略，可含密码。

### 2. 读取配置并写入运行文件

```sh
node scripts/setup.mjs
```

该脚本是两种启动方式共用的配置步骤：

1. 读取并校验 `voex.config.json`；缺少文件且处于交互终端时逐项询问并生成；
2. 检查 MySQL 端口可达；
3. 创建 `.voex/secrets/` 下的签名密钥（已有文件不覆盖）、`.voex/data/` 存储目录；
4. 将配置转换为 `.voex/runtime/server.env`。

`--check` 只校验配置和数据库端口，不写运行文件。

### 3. 一键启动前后端

```sh
node scripts/dev.mjs
```

执行内容：

- 检查 Node.js、Go、pnpm 和 MySQL；
- `web/` 依赖缺失或 lockfile 变化时执行 `pnpm install --frozen-lockfile`；启用协同时同样处理 `server/collab/`；
- 下载 MathJax 3.2.2 到 `.voex/cache/`，校验 SHA-256 后复制到 `web/public/vendor/`；
- 编译 Go API 到 `.voex/build/voex-server`，正常启动运行 `init-db` 创建缺失数据库和表，并检查数据库账号、表结构、存储目录和密钥；`--check` 仅运行 `check-config`；
- 启动 Go API 和 Vite 前端，等待 `/api/health/ready` 与前端页面就绪。

访问 `http://127.0.0.1:3500/app/`。Vite 将 `/api` 代理到 `voex.config.json` 的 `host:port`（默认 `127.0.0.1:8080`），协同 WebSocket 代理到 `collaborationPort`。

- 修改前端源码由 Vite 热更新；修改 Go 代码后重新执行启动命令。
- `VOEX_DEV_PORT` 修改前端端口，默认 `3500`。
- `node scripts/dev.mjs --check` 完成安装、编译和检查后退出，不启动服务。

## 二、快速部署体验（预置包）

`prebuilt/` 提交在 Git 中，包含：

- `prebuilt/web/`：已构建前端（资源路径 `/app/`，含 MathJax）；
- `prebuilt/server/voex-server-<平台>.gz`：Linux/Windows/macOS x64/arm64 Go 服务；
- `prebuilt/collab/`：可选的多人协同服务；
- `prebuilt/MANIFEST.json`：构建时间、平台列表及各目录/文件的 SHA-256。

### 使用步骤

1. 安装并启动 MySQL 8，准备具备所需权限的数据库账号。
2. `cp voex.config.example.json voex.config.json`，填写数据库等配置。
3. 执行：

```sh
node scripts/start.mjs
```

脚本会校验清单和预置内容、生成 `.voex/runtime/server.env` 与密钥、把当前平台的 Go 服务解压到 `.voex/prebuilt/`，再自动创建缺失数据库和表、执行配置检查并启动。默认访问 `http://127.0.0.1:8080/app/`。

`node scripts/start.mjs --check` 只做校验，不初始化数据库、不启动服务。

### 平台与更新

- 预置平台为 `linux-amd64`、`linux-arm64`、`windows-amd64`、`windows-arm64`、`darwin-amd64`、`darwin-arm64`；启动脚本自动选择当前 Node.js 运行架构对应的产物。
- 修改 `voex.config.json` 后重新执行 `node scripts/start.mjs` 即可，不需要重新打包。
- Pexels Key 通过 Go API 的 `/api/public/config` 在运行时返回，预置前端无需重建。
- 预置前端和协同服务的内容摘要不一致时脚本会拒绝启动，避免运行被篡改的产物。

### 维护者重新打包

```sh
node scripts/package.mjs
```

需要 Node.js、pnpm、Go 和网络（首次下载 MathJax；之后使用 `.voex/cache/`）。脚本重新生成前端、六个平台的 Go 服务、协同服务和 `prebuilt/MANIFEST.json`，成功后整体替换 `prebuilt/`。提交后即可发布。

## 配置

`voex.config.json` 由 Git 忽略，可从 `voex.config.example.json` 复制；JSON 不允许注释和末尾多余逗号。

| 参数 | 要求及默认值 |
| --- | --- |
| `host` | HTTP 监听地址，默认 `127.0.0.1`；允许局域网访问时可设 `0.0.0.0` |
| `port` | HTTP 端口，默认 `8080`，必须为 1–65535 的整数且未占用 |
| `database.host` | 必填，MySQL 主机名或 IP，不含协议和端口 |
| `database.port` | 默认 `3306` |
| `database.user` | 必填，数据库用户名 |
| `database.password` | 数据库密码；确实无密码的账号允许空字符串 |
| `database.name` | 必填；正常启动时自动创建缺失数据库及表 |
| `pexelsKey` | 可选，空字符串表示图库不可用；填写后在运行时提供给前端 |
| `collaboration` | 默认 `false`，按需启用多人协同 |
| `collaborationPort` | 协同内部端口，默认 `8091`，启用时不可与 HTTP 端口相同 |
| `publicUrl` | 启用协同时必填，浏览器实际访问的 origin，如 `http://localhost:8080`；不能带路径 |

HTTP 端口和数据库端口是两个不同参数。正常启动会自动补齐缺失数据库和表。账号密码错误、创建权限不足或已有表结构不兼容时会停止并输出原因；不会覆盖已有记录或自动执行改列迁移。

启用协同前还需满足 `server/docs/COLLABORATION.md` 中的数据结构要求。设置 HTTPS 的 `publicUrl` 时，需要自行配置已有 HTTPS 反向代理，脚本不申请证书。

本地启动和快速部署会为协同服务的本机访问地址自动补齐 `localhost` / `127.0.0.1` 别名。例如配置 `http://localhost:8080` 后，也允许 `http://127.0.0.1:8080`，反向同样适用；本地开发前端端口也采用此规则。别名仅限相同协议和端口，其他域名仍精确匹配配置。

## 生成文件

| 路径 | 说明 |
| --- | --- |
| `.voex/runtime/server.env` | 由配置生成的运行环境文件，每次启动重新写入 |
| `.voex/runtime/state.json` | 初始化标记；存在后缺失签名密钥会拒绝自动重建 |
| `.voex/secrets/` | `jwt-key`、`share-key`、`collab-key`；应随数据一起备份 |
| `.voex/data/` | 本机上传文件及资产存储，应与数据库、签名密钥一起备份 |
| `.voex/prebuilt/` | 快速部署解压出的当前平台 Go 服务及来源摘要 |
| `.voex/build/` | 本地启动编译的 Go 服务 |
| `.voex/cache/` | 固定版本 MathJax 3.2.2 资源、许可证缓存及本地 Go 构建缓存 |
| `web/public/vendor/` | 本地启动使用的 MathJax 静态资源，已被 Git 忽略 |

整个 `.voex/` 已被 Git 忽略。Linux 和 macOS 下敏感文件使用私有权限；Windows 下沿用目录 ACL，应使用自己的用户目录并保留访问权限。已初始化后若密钥丢失，须从备份恢复；确认要重新开始时，删除 `.voex/` 后重新生成。

## 常见问题

- **端口被占用**：修改 `voex.config.json` 的 `port`；本地启动的前端端口还受 `VOEX_DEV_PORT` 影响。
- **数据库连接或创建失败**：检查 `database` 的地址、端口、账号、密码和库名；缺库需有 `CREATE` 权限，缺表需有 `CREATE` / `REFERENCES` 权限。
- **缺少表**：重新执行不带 `--check` 的正常启动命令，自动补齐缺表；已有表缺列时按对应迁移文件处理。
- **Pexels 图库不可用**：在配置中填写 `pexelsKey` 后重新执行启动命令；预置前端无需重建。
- **预置包不支持当前平台**：改用 `node scripts/dev.mjs` 从源码启动，或在有 Go 的机器上运行 `node scripts/package.mjs`。
- **本地启动提示找不到 pnpm**：安装 pnpm，或执行 `corepack enable pnpm`。
- **MathJax 下载失败**：确认可访问 `cdn.jsdelivr.net`；已有 `.voex/cache/` 时会直接复用缓存。

## 独立部署

两条启动命令都是前台进程，不注册开机服务，也不修改现有 Nginx、PM2 或 systemd 配置。生产环境仍可继续使用原有的独立构建与部署方式：

- 前端：`cd web && pnpm install --frozen-lockfile && pnpm build`，发布 `web/dist/`（默认 `/app/`）。
- Go API：`cd server && make build`，发布 `server/bin/voex-server`。
- 协同服务：`server/deploy/collaboration/build.sh`，或按 `server/collab/README.md` 单独构建。

Go API 仅在设置 `VOEX_WEB_ROOT` 时提供前端入口；不设置时保持纯 API 服务。子目录原文档中的 `/home/voex`、`/home/voex-server` 记录了原部署布局；从新目录部署时须按实际路径调整相应配置。
