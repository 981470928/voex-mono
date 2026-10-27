# Voex

Voex 的前端、Go API 和多人协同服务源码统一存放在此仓库。前后端仍独立安装依赖、构建和部署，不要求同时启动或发布。

## 目录

| 目录 | 内容 |
| --- | --- |
| `web/` | Vue + TypeScript 前端，包含共享编辑器 schema |
| `server/` | Go API、数据库初始化 SQL、服务文档与部署示例 |
| `server/collab/` | 可选的 Node/Hocuspocus 多人协同服务 |

保留原工作区中已修改和新增的源码，不导入两个原仓库的 Git 历史。真实环境配置、密钥、node_modules 和构建产物未复制到此目录；配置示例和依赖锁文件已保留。

## 前端

环境要求与依赖版本见 [web/package.json](web/package.json)。从仓库根目录执行：

```sh
cd web
pnpm install --frozen-lockfile
# 按需参照 .env.example 创建 .env.local 并填写当前环境配置。
pnpm dev
```

独立构建：

```sh
cd web
pnpm build
```

输出为 `web/dist/`。沿用现有 Vite 配置：默认构建资源路径为 `/app/`，`build:test` 为 `/test/`，部署时需匹配访问路径和 API 反向代理。

## Go API

需要 Go（版本见 `server/go.mod`）、Make 和 MySQL。从仓库根目录执行：

```sh
cd server
cp -n .env.example .env
chmod 600 .env
# 编辑 .env，配置数据库、存储目录和 JWT 密钥文件。
make build
```

在完成环境配置后，可独立运行 `./bin/voex-server serve`。新建空库需按 [数据库说明](server/docs/db.md) 手动初始化；不要向已有业务数据库重复导入 schema。

API 的独立构建输出为 `server/bin/voex-server`。配置、接口和部署说明见 [server/README.md](server/README.md)。

## 多人协同（可选）

先安装 `web/` 的依赖，再从仓库根目录执行：

```sh
cd server/collab
pnpm install --frozen-lockfile --ignore-scripts
pnpm type-check
pnpm build
```

构建默认引用本仓库 `web/packages/editor-schema/src/index.ts`；需要覆盖时设置 `VOEX_COLLAB_SCHEMA_SOURCE`。运行使用 `server/collab/dist/` 构建产物，无需运行时访问前端源码。

配置和启用步骤见 [协同说明](server/docs/COLLABORATION.md) 与 [运行时说明](server/collab/README.md)。`server/deploy/collaboration/build.sh` 默认使用同仓库的 `web/`，仍支持 `VOEX_FRONTEND_DIR`。

## 独立部署

- 前端发布 `web/dist/`，Go API 发布 `server/bin/voex-server`，协同服务按需单独部署。
- 本次整理不迁移原目录、不变更数据库、不切换服务，也不修改 Nginx、PM2 或 systemd 配置。
- 子目录原文档与部署示例中的 `/home/voex`、`/home/voex-server` 记录了原部署布局。若从新目录部署，须按实际路径调整相应部署配置。
- 不生成、不修改、不运行单元测试；可使用类型检查、构建、`go vet` 和模块校验验证改动。

## 许可证

沿用 [PolyForm Noncommercial License 1.0.0](LICENSE)，许可证内容未修改；`web/LICENSE` 与 `server/LICENSE` 同样保留。授权范围以许可证原文为准。
