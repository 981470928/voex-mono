# 本机初始化与运行

Windows PowerShell、Windows 命令提示符与 Linux 终端使用相同的两条 Node.js 命令，命令从仓库根目录执行。

## 环境要求

- 初始化：Node.js 22.18+（22.x）或 24.12+、pnpm、Go（项目要求见 `server/go.mod`），可访问依赖源和 MathJax 固定资源地址。
- 运行已有构建：只需同一平台的 Node.js，以及可连接的 MySQL；不需要 Go、pnpm、Nginx 或全局进程管理器。
- MySQL 8 数据库应已存在，并按项目 schema 初始化。脚本不创建数据库、不导入 SQL、不自动迁移已有数据库。
- 支持 Windows / Linux 的 x64、arm64。构建面向执行初始化命令的当前平台；换电脑、系统、CPU 架构或仓库绝对路径后需要重新初始化。

## 两条命令

首次使用：

```sh
node scripts/init.mjs
```

没有 `voex.config.json` 时，脚本询问必要参数并保存配置。密码和 Key 输入时不显示。已有配置则直接读取，修改配置后再次执行此命令。

初始化会依次检查参数格式、Node.js/Go/pnpm、端口、数据库网络及可选 Pexels 授权；生成稳定的签名密钥和运行配置；构建 Go API，校验数据库账号和所需表；安装锁定版本依赖、进行类型检查并构建前端及按需启用的协同服务。全部成功才标记可运行并启动服务。

以后启动：

```sh
node scripts/run.mjs
```

此命令只校验配置、数据库和已有构建，然后启动；不会安装依赖、构建或下载资源。没有初始化状态、产物缺失或配置已变更时，明确提示先运行初始化命令。Ctrl+C 协调停止脚本启动的服务；启用协同时，先将未落库编辑排空，再停止协同进程和 Go API。排空失败会保留进程并提示处理后重试，避免丢失编辑。

默认访问 `http://127.0.0.1:8080/app/`。界面、API 和可选协同 WebSocket 共用一个 HTTP 端口。默认以前台进程运行，不注册开机服务。

## 配置

可通过首次交互生成 `voex.config.json`，也可复制根目录 `voex.config.example.json` 后填写；JSON 不允许注释和末尾多余逗号。

| 参数 | 要求及默认值 |
| --- | --- |
| `host` | HTTP 监听地址，默认 `127.0.0.1`；允许局域网访问时可设 `0.0.0.0` |
| `port` | HTTP 端口，默认 `8080`，必须为 1–65535 的整数且未占用 |
| `database.host` | 必填，MySQL 主机名或 IP，不含协议和端口 |
| `database.port` | 默认 `3306` |
| `database.user` | 必填，数据库用户名 |
| `database.password` | 数据库密码；确实无密码的账号允许空字符串 |
| `database.name` | 必填，已存在且完成初始化的数据库名称 |
| `pexelsKey` | 可选，空字符串表示图库不可用；填写后在初始化时校验授权 |
| `collaboration` | 默认 `false`，按需启用多人协同 |
| `collaborationPort` | 协同内部端口，默认 `8091`，启用协同时不可与 HTTP 端口相同 |
| `publicUrl` | 启用协同时必填，用户浏览器实际访问的 origin，如 `http://localhost:8080`；不能带 `/app/` 等路径 |

HTTP 端口和数据库端口是两个不同参数。脚本不自动安装或启动 MySQL。初始化发现缺表时会停止，并给出 schema 路径；请只向新建空库导入 `server/internal/database/schema.sql`。已有数据库应由维护者核对后显式迁移。

Pexels Key 沿用现有前端使用方式，在构建时写入前端资源；修改该值后必须重新初始化构建。启用协同前还需满足 `server/docs/COLLABORATION.md` 中的数据结构要求。设置 HTTPS 的 `publicUrl` 时，需要自行配置已有 HTTPS 反向代理，脚本不申请证书。

## 其他用法

仅初始化和打包，不启动：

```sh
node scripts/init.mjs --no-start
```

初始化前的基础检查，不写配置、不构建（只验证数据库端口可达，不验证数据库账号和表结构）：

```sh
node scripts/init.mjs --check
```

检查已完成的初始化，不启动：

```sh
node scripts/run.mjs --check
```

## 文件与独立部署

- `voex.config.json`：本机配置，含密码及可选 Key，已被 Git 忽略。
- `.voex/secrets/`：自动生成的稳定签名密钥；重复初始化不覆盖。已初始化后若密钥丢失，须从备份恢复。
- `.voex/data/`：本机上传文件及资产存储。应与数据库、签名密钥一起备份。
- `.voex/releases/`：各次构建输出及生成的 `server.env`。失败的构建不会替换成功记录，也不会自动清理旧产物。
- `.voex/active.json`：最近一次成功构建的路径、平台及摘要。运行命令用它确认产物完整。
- `.voex/cache/`：固定版本 MathJax 3.2.2 资源及许可证缓存；资源与原部署版本相同，下载后检查 SHA-256，不更改依赖版本。
- `.voex/init.lock`：防止同时初始化。若任务被强制中断，确认没有初始化任务后可移除残留锁文件。

整个 `.voex/` 已被 Git 忽略。文件权限在 Linux 下使用私有权限；Windows 下沿用目录 ACL，应使用自己的用户目录并保留访问权限。Windows 存储目录建议位于本机 NTFS，以支持同卷硬链接发布；Windows 未提供与 Unix 目录 fsync 等价的受支持方式，此处保留文件 FlushFileBuffers 和同卷硬链接，不对目录执行 fsync。Linux 仍保留文件及目录同步。

原有独立构建和部署仍可继续使用。Go API 仅在设置 `VOEX_WEB_ROOT` 时提供前端入口；不设置时保持 API 服务。前端继续支持 `web/` 中的独立构建方式。本机脚本不会调整原目录、现有 Nginx/PM2/systemd 配置或已有数据库。
