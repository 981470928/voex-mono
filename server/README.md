# voex-server

Gin + GORM HTTP 服务：账号认证、团队与项目权限、单层目录、Markdown 文档、附件、资产图片与文件分享。API 前缀 `/api`；独立二进制默认监听 `127.0.0.1:8090`。

当前文件后端为主机本地 `/home/static`。通过原生 Go 二进制运行服务，数据库与文件存储由开发环境自行配置。

## 源码环境与运行

- Go 1.27.1，版本依赖固定在 `go.mod` / `go.sum`。服务器已安装的 `go` / `gofmt` 位于 `/usr/local/bin`。
- Make、MySQL 8；图片校验使用 Go 标准库与 `golang.org/x/image/webp`，无需 libvips。
- 服务用户须能读写专用绝对路径 `VOEX_STORAGE_ROOT`，默认 `/home/static`；目录不得通过符号链接逃逸到其他位置。
- 原生 Go API 不依赖 Node.js；前端在独立仓库使用 pnpm 构建。

以下命令仅用于已明确指定的开发数据库；新环境填写 `.env`，已有配置应保留。服务只连接已有数据库；空库需先手动导入 `internal/database/schema.sql`，启动时不建库、不修改表结构。

```sh
cd /home/voex-server
cp -n .env.example .env
chmod 600 .env
# 编辑 .env，设置开发 MySQL、VOEX_STORAGE_ROOT 和 JWT_SECRET_FILE。
make build
make check
./bin/voex-server serve
```

数据库初始化、表结构与业务一致性约定见 [数据库](docs/db.md)。

`.env` 自动加载，进程环境变量优先；`VOEX_ENV_FILE` 可指定其他配置文件。默认模块代理不可达时可使用 `GOPROXY=https://goproxy.cn,direct go mod download`，保持 Go checksum 校验。`make build` 原子替换 `bin/voex-server`；`make fmt` 格式化 `cmd` 和 `internal`；`make check` 执行 `go vet` 与 `go mod verify`，不运行单元测试。

## 项目结构

| 目录                                                        | 职责                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| `cmd/voex-server`                                           | HTTP 服务入口（默认运行 `serve`）             |
| `internal/app`、`internal/config`                           | 依赖组装、服务生命周期和环境配置                         |
| `internal/router`、`internal/middleware`                    | Gin 路由、登录、CORS 与日志                     |
| `internal/handler`、`internal/transport`                    | 参数解析、HTTP / JSON / Cookie                |
| `internal/service`、`internal/repository`、`internal/model` | 业务规则、权限、事务及 GORM 数据访问                     |
| `internal/database`                                         | MySQL 连接与空库初始化 SQL |
| `internal/filestore`                                        | 本地不可变文件、私有暂存、原图校验与 Range 下载          |
| `docs`                                                      | 架构、数据库、路由及业务接口说明                     |

依赖方向与事务规则见 [架构](docs/architecture.md)，端点见 [路由](docs/routes.md)，账号与团队接口见 `docs/AUTH-API.md` / `docs/TEAM-API.md`。模型不调用 `AutoMigrate`。

## 本地文件存储

只需配置本地存储根，不再配置 R2 凭据：

```dotenv
VOEX_STORAGE_ROOT=/home/static
```

| 内容                   | 主机路径                                         |
| ---------------------- | ------------------------------------------------ |
| 文档附件               | `/home/static/attachments/{sha256}`              |
| 普通资产、头像与缩略图 | `/home/static/assets/{directory}/{storage_name}` |
| 每进程上传暂存         | `/home/static/.uploads/{process_uuid}/...`       |

文件内容在本地，MySQL 保存元数据、文档关联及权限。`local.go` 通过受限文件系统根和路径校验访问文件；上传完整写入并同步后以不覆盖的硬链接发布，附件仍按 hash 复用。未提交的 UUID 资产尝试删除；共享附件不随关联删除，避免影响其他文档，没有自动孤儿文件清理任务。异常退出遗留的 `.uploads` 文件不会被自动扫描删除，只能在确认没有进程使用后人工处理。

头像和缩略图只接受可完整解码的静态 PNG / JPEG / WebP，沿用 5 MiB / 20 MiB 与 2000 万像素限制；保存原始字节和实际 MIME，不自动转换 WebP。文件仍必须经过既有 API 鉴权，主机目录不映射为 Nginx 公共目录；HEAD、单段/多段 Range、ETag 与条件请求保留。超过 16 段 Range 按完整响应处理。

本次不迁移历史 R2 文件、不回退读取 R2，也不删除远端桶或对象。旧数据库中已有的元数据不代表对应内容已经出现在本地：缺失本地文件按原下载接口返回不存在。需要历史内容时应另行制定迁移方案，不能把改配置当作迁移已完成。旧远端数据与旧环境继续保留。

`JWT_SECRET_FILE` 仍是登录签名密钥路径；默认 `/home/server/.secrets/jwt-key`。保留密钥才能维持既有会话。`VOEX_TEMP_DIR`、R2 配置和旧 `/home/update` 不属于当前存储路径配置。

## 验证与备份

按项目约束不生成、不修改、不运行单元测试。使用格式检查、构建、`go vet`、模块校验及隔离数据库 HTTP 冒烟验证。

2026-09-24 迁移已通过 277 项隔离 HTTP 检查和 14 项原服务只读响应对比；临时数据库与验证进程已清理。证据保存在 `.go-backup-path` 指向的仓库外目录 `validation/`。

项目内旧源码、依赖、构建产物及历史代码副本已删除。仓库外备份包含迁移前代码、数据库快照、进程配置，以及删除前的完整旧项目归档 `legacy-complete-before-removal.tgz`。需要回滚时先在独立目录恢复归档并核对进程配置；不要用数据库快照覆盖正常业务写入。

## Gin/GORM 改写验证与回滚

本次框架改写已保留全部 54 个业务路由及 GET 对应的 HEAD 行为。验证覆盖团队/工作区 159 项、文件/分享/HEAD/Range 94 项、认证互通 45 项，以及现有数据只读对比和 HEAD 30 项；不执行单元测试。

框架改写前的 Go 源码、二进制、环境配置和验证记录保存于 `.gin-backup-path` 指向的仓库外目录。以下为旧 Gin/GORM 改写的历史回滚记录。旧二进制必须与目标数据库结构匹配；核对数据库结构及备份后，历史 PM2 环境的二进制切回方式为：

```sh
cd /home/voex-server
backup=$(cat .gin-backup-path)
install -m 755 "$backup/voex-server" bin/voex-server.rollback
mv bin/voex-server.rollback bin/voex-server
pm2 restart voex-server
pm2 save
```

该操作保留现有数据库、上传内容和登录密钥；源码恢复需另行核对归档或 Git 版本。

## 多人协同

协同能力通过独立 Node/Hocuspocus 进程接入，Go 保留权限与 MySQL 事务；默认关闭。开启前需显式执行协同 SQL 并配置服务间密钥和浏览器 Origin。构建、原生进程配置、Nginx 与更新恢复步骤见 [多人协同](docs/COLLABORATION.md)。

## 许可证

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。

个人和团队可以在许可证允许的非商业用途范围内私有化部署、使用、修改和分发本项目。商业用途需另行获得权利人的授权；内网部署或团队内部使用本身不代表非商业用途。

以上仅为说明，完整授权范围、义务及例外以 [LICENSE](LICENSE) 原文为准。
