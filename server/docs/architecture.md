# 项目结构与职责

## 目录与进程

```text
voex-server/
├── cmd/voex-server/          # HTTP 服务入口
├── internal/
│   ├── app/、config/         # 服务生命周期、配置读取与依赖组装
│   ├── database/            # MySQL 连接与空库初始化 SQL
│   ├── model/、repository/  # 模型与 GORM 数据访问
│   ├── service/             # 权限、事务、版本冲突和业务规则
│   ├── handler/、transport/ # Gin HTTP / JSON / Cookie
│   ├── router/、middleware/ # 路由、认证、CORS 与日志
│   ├── identity/、security/ # 当前用户、JWT、限流、可信代理
│   ├── filestore/           # 本地不可变文件、暂存、图片校验与 Range
│   └── shared/              # 校验、标识及业务错误
├── docs/                    # 架构、路由、数据库与业务接口
└── bin/                    # 不入 Git 的构建产物
```

## 请求与依赖方向

`router → middleware → handler → service → repository → GORM/MySQL`。

Handler 从 Gin Context 读取输入，把标准 `context.Context`、标识与参数交给 Service，并负责状态码、JSON、Cookie 和流式响应。GET / HEAD 继续各自原有注册与权限；健康端点见 [routes.md](routes.md)。

Service 负责业务校验、当前用户权限、团队规则、文档 revision 与事务组合；常规业务不依赖 Gin，不直接执行 Repository 查询。Repository 独占 GORM 数据访问，DTO 投影保留原 NULL、数字和时间语义，模型不直接作为用户响应暴露。

Filestore 由 Service 在授权后调用：`store.go` 解析上传、校验图片和生成相对 key；`local.go` 管理专用 `os.Root`、路径校验和原子发布；`download.go` 使用本地可 seek 文件提供 HEAD / Range / ETag / 条件请求。`/home/static` 不直接公开，普通访问仍经过原项目、文档、资产或分享权限。当前实现没有 R2 读写客户端，也不迁移或删除历史远端对象。

## 数据库生命周期

服务只连接已初始化的 MySQL 数据库，不自动建库、建表或修改结构。当前完整表结构保存在 `internal/database/schema.sql`，仅供新空库手动初始化，包含 `workspace_state.id=1` 的初始锁记录。已有数据库由开发者显式维护，详见 [db.md](db.md)。

健康检查保留 `/api/health/live` 与 `/api/health/ready`；就绪检查核对数据库连接与文件存储目录，不依赖迁移版本或账本。

## 一致性与文件发布

- GORM 池最多 10 个连接，查询与事务绑定请求 context；业务事务使用 REPEATABLE READ。
- 结构写操作先锁 `workspace_state.id=1`，随后检查权限与 revision；事务异常回滚，文档保存冲突保持 HTTP 409。
- 关闭 GORM 对单条操作的冗余自动事务；日期由数据库维护并统一输出 UTC ISO。
- 附件先授权、暂存并发布本地文件，再在写事务内重新授权并建立关联，避免传输占用工作区锁。
- 上传暂存在 `/home/static/.uploads/{process_uuid}`；完整写入并同步后硬链接发布，不覆盖已有对象。附件按 hash 共享，关联删除不删除文件；独立 UUID 资产数据库提交失败时尝试删除。
- 头像与缩略图校验 PNG / JPEG / WebP 后保存原始内容和实际 MIME，不自动转换。

## 错误与扩展

业务校验通过 `shared.HTTPError` 终止请求；Recovery 返回 `{error: ...}`。存储缺失返回 404，本地 I/O 故障返回 502；响应已开始后读取失败中止 HTTP 传输，避免把截断下载当成功。日志不输出 SQL 参数、密码、token、查询字符串或物理存储路径。

新增业务接口沿用 Repository → Service → Handler 分层，开发阶段结构变化同步维护空库初始化 SQL；同时维护路由、数据库及领域文档。验证使用 `make fmt`、`make check`、`make build` 和隔离环境 HTTP / 浏览器检查，不生成、修改或运行单元测试。本文记录实现和操作约定。
