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
  <a href="#功能清单"><strong>功能清单</strong></a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#手动打包">手动打包</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#本地开发">本地开发</a>
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

## 功能清单

| 功能          | 可以做什么                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------ |
| Markdown 编辑 | 在正文中插入表格、公式、Mermaid 流程图、图片和附件。                                       |
| 工作区与搜索  | 按团队、项目和文件夹整理文档，从最近访问返回上次打开的文件，或全文搜索有权查看的内容。     |
| 多人协作      | 启用协同服务后，多人可以同时编辑同一份文档，实时看到彼此的修改。                           |
| 权限与分享    | 管理团队成员和文档访问权限，通过只读或可编辑链接分享单篇文档。                             |
| 版本与恢复    | 查看自动快照，为重要版本命名，对比并恢复正文。删除的文档可从回收站恢复。                   |
| 导入与导出    | 导入单个 `.md` 或 `.voex` 文件。使用 `.voex` 可一起迁移文档结构和附件，也可导出 Markdown。 |
| AI 辅助       | 配置自己的模型，围绕当前文档提问、查看对话历史，并在审阅修改建议后决定是否写入正文。       |

### 体验地址

[点击此处体验](https://voex.jmin.win/app/)

## 本地开发

开发环境需要 Node.js（22.x ≥ 22.18 或 ≥ 24.12）、pnpm、Go 1.27.1 和 MySQL 8。首次使用时，在 `web/` 执行 `pnpm install --frozen-lockfile`。前后端分别从各自的 `.env.example` 复制一份 `.env` 并填写。已有配置可直接沿用。

在两个终端分别启动前端和后端。

| 服务 | 工作目录  | 开发命令      | 默认地址                     |
| ---- | --------- | ------------- | ---------------------------- |
| 前端 | `web/`    | `npm run dev` | `http://127.0.0.1:3500/app/` |
| 后端 | `server/` | `go run .`    | `http://127.0.0.1:8090/api`  |

正文协同编辑还需要启动 [协同服务](server/collab/README.md)。

## 手动打包

| 服务 | 工作目录  | 构建命令        | 产物                                                 |
| ---- | --------- | --------------- | ---------------------------------------------------- |
| 前端 | `web/`    | `npm run build` | `web/dist/`                                          |
| 后端 | `server/` | `go build`      | `server/voex-server`（Windows 为 `voex-server.exe`） |

前端在构建时读取 `web/.env`，后端在运行时读取 `server/.env`。首次构建和配置示例见[手动打包说明](docs/deployment.md)。

## 文档导航

| 文档                                     | 内容                       |
| ---------------------------------------- | -------------------------- |
| [手动打包](docs/deployment.md)           | 前后端配置、命令与产物     |
| [后端说明](server/README.md)             | Go API 与文件存储          |
| [多人协同](server/docs/COLLABORATION.md) | 协同连接、持久化与部署要求 |
| [数据库说明](server/docs/db.md)          | 数据结构、初始化与迁移     |
| [权限模型](server/docs/PERMISSIONS.md)   | 团队、项目、文档与分享权限 |
| [AI 接口](server/docs/AI-API.md)         | 模型配置、对话和审阅应用   |

## 许可证

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。商业用途需另行获得权利人的授权，完整授权范围、义务及例外以许可证原文为准。<code>web/LICENSE</code> 与 <code>server/LICENSE</code> 保持一致。

<p align="center">
  <sub>Voex · 专注表达，让知识有序。</sub>
  <br />
  <a href="#voex">返回顶部 ↑</a>
</p>
