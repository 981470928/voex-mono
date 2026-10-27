<p align="center">
  <a href="#voex">
    <img src="web/src/assets/image/voex-logo-color-640.png" width="210" alt="Voex Logo" />
  </a>
</p>

<h1 align="center">Voex</h1>

<p align="center">
  面向个人与团队的文档协作平台
  <br />
  Markdown 编辑 · 实时协同 · AI 辅助 · 自托管部署
</p>

<p align="center">
  <a href="web/package.json"><img src="https://img.shields.io/badge/Vue-3.5-42b883?style=flat-square&amp;logo=vuedotjs&amp;logoColor=white" alt="Vue 3.5" /></a>
  <a href="web/package.json"><img src="https://img.shields.io/badge/TypeScript-6.0-3178c6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript 6.0" /></a>
  <a href="server/go.mod"><img src="https://img.shields.io/badge/Go-1.27.1-00add8?style=flat-square&amp;logo=go&amp;logoColor=white" alt="Go 1.27.1" /></a>
  <a href="server/collab/package.json"><img src="https://img.shields.io/badge/Yjs-Realtime-16b8a6?style=flat-square" alt="Yjs 实时协同" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-PolyForm_Noncommercial-64748b?style=flat-square" alt="PolyForm Noncommercial License 1.0.0" /></a>
</p>

<p align="center">
  <a href="#快速开始"><strong>快速开始 →</strong></a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#本地开发">本地开发</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="docs/deployment.md">部署文档</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://github.com/981470928/voex-mono/issues">反馈问题</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme-hero-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/images/readme-hero-light.svg" />
    <img src="docs/images/readme-hero-light.svg" width="100%" alt="从一个想法，到一份共同完成的文档。专注表达，实时协同，知识有序。" />
  </picture>
</p>

## 为写作与协作而生

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>专注表达</h3>
      <p>基于 Milkdown 的 Markdown 编辑体验，支持公式、流程图、图片与附件，让内容与结构一起成形。</p>
    </td>
    <td width="33%" valign="top">
      <h3>一起完成</h3>
      <p>基于 Yjs 与 Hocuspocus 同步正文，结合团队、项目和分享权限，让多人围绕同一份文档协作。</p>
    </td>
    <td width="33%" valign="top">
      <h3>AI 辅助</h3>
      <p>在文档中发起 AI 对话、审阅修改建议，确认应用后再写入正文，保留每一次修改的决定权。</p>
    </td>
  </tr>
</table>

- **有序管理**：按团队、项目和文件夹组织内容，配合最近访问、分享与回收站管理文档。
- **附件随文档流转**：上传图片与文件，通过文档权限控制访问，附件变更通知在线协作者。
- **自托管部署**：Vue + TypeScript 前端、Go API 与可选协同服务统一维护，提供源码启动和多平台预置包。

## 选择启动方式

| | 快速体验与部署 | 本地开发 |
| --- | --- | --- |
| 适合 | 使用项目、部署自己的实例 | 修改前端、后端或协同服务 |
| 环境 | Node.js + MySQL 8 | Node.js + pnpm + Go + MySQL 8 |
| 构建 | 使用仓库内预置包 | 从源码安装依赖并构建 |
| 入口 | [快速开始 ↓](#快速开始) | [本地开发 ↓](#本地开发) |

两种方式共用根目录的 <code>voex.config.json</code> 和同一套运行配置。配置只写在本地，不进入 Git。

## 快速开始

仓库中的 [`prebuilt/`](prebuilt/) 已提前打包前端、Go 服务和协同服务，并提交到 Git。下载仓库后不需要安装 Go、pnpm，也不需要重新构建，**只需填写配置并执行一条启动命令**。

### 1. 准备环境

- Node.js 22.18+（22.x）或 24.12+（仅用于运行脚本和协同服务）。
- 已启动的 MySQL 8；配置账号需能创建缺失数据库和表。正常启动自动初始化，无需先手动导入 SQL。

- 支持 Windows / Linux / macOS 的 x64、arm64（Intel Mac 和 Apple Silicon）。

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
4. 自动创建缺失数据库和表，再检查数据库账号、表结构和存储目录；
5. 启动 Go API；前端和 API 共用一个 HTTP 端口，按需启动协同服务。

默认访问 `http://127.0.0.1:8080/app/`，Ctrl+C 停止。只检查不启动：`node scripts/start.mjs --check`。

预置包覆盖 `linux-amd64`、`linux-arm64`、`windows-amd64`、`windows-arm64`、`darwin-amd64`、`darwin-arm64`。当前平台不在清单中时，脚本会明确提示改用本地启动。

## 本地开发

### 1. 准备环境

- Node.js 22.18+（22.x）或 24.12+，以及 pnpm（Node 自带的 corepack 也可：`corepack enable pnpm`）。
- Go 1.27.1（以 [`server/go.mod`](server/go.mod) 为准）。
- 已启动的 MySQL 8。正常启动会自动创建配置中缺失的数据库、表和工作区锁记录；创建操作需要账号具备相应的 `CREATE` / `REFERENCES` 权限。已有表的列结构变化仍按 [数据库说明](server/docs/db.md) 显式迁移。

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
4. 编译 Go API 到 `.voex/build/voex-server`，自动创建缺失数据库和表后执行配置检查；
5. 同时启动 Vite 前端和 Go API，等待两者就绪。

访问 `http://127.0.0.1:3500/app/`。前端由 Vite 提供热更新，`/api` 请求代理到 `http://127.0.0.1:8080`；按 Ctrl+C 同时停止两个进程。

- 前端端口可用 `VOEX_DEV_PORT` 修改，默认 `3500`。
- 后端监听地址/端口取自 `voex.config.json` 的 `host` / `port`。
- 只检查环境、安装依赖和编译，不启动服务：`node scripts/dev.mjs --check`。
- 修改 Go 代码后需重新执行 `node scripts/dev.mjs`。

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
| `database.name` | 必填；正常启动时自动创建缺失数据库及表 |
| `pexelsKey` | 可选，空字符串表示图库不可用；通过 `/api/public/config` 在运行时提供给前端 |
| `collaboration` | 默认 `false`，按需启用多人协同 |
| `collaborationPort` | 协同内部端口，默认 `8091`，启用时不可与 HTTP 端口相同 |
| `publicUrl` | 启用协同时必填，浏览器实际访问的 origin，如 `http://localhost:8080`；不能带 `/app/` 等路径 |

HTTP 端口和数据库端口是两个不同参数。脚本不会安装或启动 MySQL；正常启动仅创建缺失数据库、表和工作区锁记录，不自动改动已有表的列结构。`--check` 不执行数据库初始化。启用协同前还需满足 [协同说明](server/docs/COLLABORATION.md) 中的数据结构要求。

## 多人协同（可选）

在 `voex.config.json` 中设置 `collaboration: true`，填写 `publicUrl`，并确认 `server/docs/COLLABORATION.md` 中的数据库迁移已执行。

- 本地启动会自动安装并构建 `server/collab/`，随后与前端、Go API 一起启动。
- 本地启动和快速部署会自动兼容 `localhost` 与 `127.0.0.1` 的协同连接，协议和端口必须一致；其他域名仍按配置精确匹配。
- 快速部署直接使用 `prebuilt/collab/`，不读取前端源码。
- 协同进程只监听 `127.0.0.1:collaborationPort`，浏览器通过 Go API 的 `/api/collab/ws` 访问；停止时先排空未落库编辑，再依次停止协同服务和 Go API。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `web/` | Vue + TypeScript 前端，包含共享编辑器 schema |
| `server/` | Go API、数据库初始化 SQL、服务文档与部署示例 |
| `server/collab/` | 可选的 Node/Hocuspocus 多人协同服务 |
| `prebuilt/` | 提交到 Git 的前端、Go 服务和协同服务预置产物及清单 |
| `scripts/` | 配置、本地启动、快速部署和打包脚本 |
| `docs/` | 本机启动与部署说明 |

<details>
<summary>展开查看本机配置与运行时目录</summary>

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

</details>

## 维护预置包

预置包由维护者在具备完整工具链的机器上生成：

```sh
node scripts/package.mjs
```

该命令会重新构建 `prebuilt/web/`、六个平台的 Go 服务（gzip 压缩）和 `prebuilt/collab/`，并写入 `prebuilt/MANIFEST.json`。完成后提交 `prebuilt/` 即可发布。不要手工修改预置产物。

## 独立部署

两条启动命令都是前台进程，不注册开机服务，也不修改现有 Nginx、PM2 或 systemd 配置。生产环境可以继续使用原有的独立构建与部署方式：

- 前端发布 `web/dist/`（默认资源路径 `/app/`，`build:test` 为 `/test/`）；
- Go API 发布 `server/bin/voex-server`；
- 协同服务按需单独部署。

详细参数、目录和常见问题见 [部署文档](docs/deployment.md)。子目录原文档中的 `/home/voex`、`/home/voex-server` 记录了原部署布局；从新目录部署时须按实际路径调整。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [部署指南](docs/deployment.md) | 启动、运行配置与常见问题 |
| [后端说明](server/README.md) | Go API 与文件存储 |
| [多人协同](server/docs/COLLABORATION.md) | 协同连接、持久化与部署要求 |
| [数据库说明](server/docs/db.md) | 数据结构、初始化与迁移 |
| [权限模型](server/docs/PERMISSIONS.md) | 团队、项目、文档与分享权限 |
| [AI 接口](server/docs/AI-API.md) | 模型配置、对话和审阅应用 |

## 许可证

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。商业用途需另行获得权利人的授权，完整授权范围、义务及例外以许可证原文为准。<code>web/LICENSE</code> 与 <code>server/LICENSE</code> 保持一致。

<p align="center">
  <sub>Voex · 专注表达，让知识有序。</sub>
  <br />
  <a href="#voex">返回顶部 ↑</a>
</p>
