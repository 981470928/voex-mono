> 当前权限、固定分享与回收站规则以 [PERMISSIONS.md](PERMISSIONS.md) 为准，旧版本描述不再作为鉴权依据。

# 数据库

Go 服务通过 GORM / `gorm.io/driver/mysql` 访问 MySQL 8，驱动版本固定于 `go.mod`。连接参数为 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`；不在文档保存真实密码。服务连接配置指定的数据库，并在正常启动时创建缺失数据库和表。

## 初始化与连接

服务默认运行 `serve`，使用内嵌的 `internal/database/schema.sql` 自动创建缺失数据库和表，并幂等补上 `workspace_state.id=1` 的工作区锁记录。也可单独执行 `voex-server init-db` 初始化并检查配置；两条一键启动脚本在正常启动前调用此命令。`voex-server check-config` 和脚本的 `--check` 不执行数据库初始化。

初始化按外键依赖顺序补齐缺表，使用同一 MySQL 会话的数据库命名锁串行执行；创建语句采用 `IF NOT EXISTS`，中断后可以重试。已有表跳过创建，已有记录不覆盖；该逻辑不修改已有列、不自动运行历史数据迁移。结构变化仍由开发者显式维护，并同步更新初始化 SQL；没有迁移账本。新建 documents 表已直接包含 content_mode，已有 documents 表缺少此列时仍需显式协同迁移。

连接池最多 10 个连接，查询和事务绑定请求 context，业务事务使用 REPEATABLE READ；没有 GORM `AutoMigrate`。缺库需要对应的 `CREATE` 权限，补表需要 `CREATE` / `REFERENCES` 权限；对象已齐全时不再执行 DDL，日常服务只需业务表读写权限。

`documents.updated_by=null`、`updated_by_anonymous=false` 表示未记录修改人；匿名分享修改为 null / true，登录修改为用户 ID / false。

## 表与业务一致性

| 表                                                  | 用途                                                   |
| --------------------------------------------------- | ------------------------------------------------------ |
| `users`、`auth_sessions`                            | 账号、Argon2id 密码哈希、用户自定义 JSON 配置与登录会话 |
| `teams`、`team_members`                             | 团队、个人团队与成员角色                               |
| `team_invites`、`team_join_requests`                | 邀请凭证哈希与入队审批                                 |
| `projects`、`project_members`、`folders`            | 团队项目、授权与单层文件夹                             |
| `documents`                                         | Markdown 正文、目录、最后修改人、revision 与软删除状态 |
| `document_versions`                                 | 文档历史快照、类型、标签、正文作者与稀释清理状态       |
| `files`、`assets`                                   | 文档附件关联与 UUID 资产元数据                         |
| `file_shares`                                       | 文档分享凭证哈希、编辑权限与撤销                       |
| `recent_files`                                      | 按账号和文档去重的查看记录及已验证分享 ID              |
| `ai_models`、`ai_review_applications`               | 模型配置与审阅应用记录                                 |
| `ai_conversation_turns`、`ai_conversation_sessions` | 对话轮次、独立会话和不可变审阅快照                     |
| `workspace_state`                                  | 工作区写锁                                   |

`users.user_config` 为非空 JSON 列，默认 `(JSON_OBJECT())`；新注册账号使用数据库默认值。配置只按当前用户 ID 读取和修改，合并事务仅锁对应 users 行，不使用全局工作区锁；内部结构由前端决定，接口见 [USER-CONFIG-API.md](USER-CONFIG-API.md)。

结构写入事务先锁 `workspace_state.id=1`，再验证权限和修改数据；正文 revision 冲突保持 409。最近记录不保存或返回原始分享 token，撤销分享后每次请求重新授权；移除记录不删除原文、附件或分享。

## 文件与备份边界

文件内容保存于主机 `VOEX_STORAGE_ROOT`（默认 `/home/static`），元数据和关联在 MySQL。附件为 `attachments/{sha256}`，资产为 `assets/{directory}/{storage_name}`，临时上传位于 `.uploads`；附件关联删除不删除共享内容。HTTP 读写权限保持原授权接口，不公开静态目录。

本次不迁移历史 R2 对象、不回退读 R2，也不删除远端数据或改写历史元数据。旧内容未出现在本地时会按原下载接口返回不存在，独立部署不导入旧库。

数据库、文件内容和登录签名密钥需一起纳入人工备份。备份包含凭据和业务数据，应保存在非公共目录，恢复前核对目标环境并停止写入。

## 文件账号授权

`document_access` 按 document_id + user_id 保存 read/edit，外键随文件或账号删除清理。登录用户打开有效分享链接时幂等写入，只能从 read 升级 edit，后续只读链接不能降级。授权独立于 recent_files 和 file_shares，历史清理或链接撤销不撤销已有权限。

已有环境部署前显式执行 `internal/database/document-access.sql`；该脚本创建新表，并从仍有效的已访问分享记录回填授权，重复执行不会把 edit 降为 read。新环境及自动补表已包含此表；历史授权回填仍须显式执行迁移，不由建表代替。

## 协同正文

可选协同模块新增 documents.content_mode、document_collaboration（二进制当前状态）、collaboration_commits（7 天提交幂等回执）与 collaboration_outbox（事务事件）。已有库先备份停写，再显式执行 collaboration.sql；空库 schema.sql 已包含新结构。Yjs 状态与 Markdown 投影、revision 在同一事务提交；详情见 [多人协同](COLLABORATION.md)。

## 文档历史版本

文档历史新增 document_versions（Markdown 快照、kind 为 auto/manual/backup、正文作者与 schema_version）。已有库显式执行 `internal/database/document-history.sql`；该脚本只建表、**不回填历史数据**，历史从部署后开始记录。空库 schema.sql 与自动补表已包含此表。

版本行随文档彻底删除级联清理，软删除保留。`manual`/`backup` 永久保留且不参与稀释；`auto` 由 history_cleanup 按 7 天全保、8–30 天每小时 1 条、31–90 天每日 1 条、更旧删除的规则稀释，并受单文档上限裁剪。行为与接口见 [文档历史版本](DOCUMENT-HISTORY.md)。

## 全文搜索

documents.file_name + file_content 上的全文索引 `ft_documents_search`（MySQL ngram 解析器）供 `/api/search` 使用；ngram_token_size 默认 2，与接口最少 2 字符的搜索词对齐（中文双字成词）。正文列是协同/AI 提交时同步维护的 Markdown 投影，collab 文档同样覆盖。

已有库显式执行 `internal/database/document-search.sql`；脚本按 information_schema 判断索引是否已存在，重复执行幂等。空库 schema.sql 直接包含该索引。**部署顺序：先跑迁移再发版**——服务启动时校验索引存在，缺失即拒绝启动。建索引为在线 DDL，长文本大表上耗时较长，安排在低峰执行。搜索接口的可见性规则见 [权限规则](PERMISSIONS.md)。

## SQL 查询索引审计（2026-11-05）

目标：`192.140.173.58:3306/voex-dev`，MySQL 8.0.46；25 张业务表，新增 3 个索引后共 88 个索引。仅变更当前项目配置的数据库。

检查范围：全部 server Go 源码中的 GORM、database/sql、Raw/Exec 查询，协同 TypeScript 源码，以及 internal/database 下全部现有 SQL 脚本。读取 information_schema 索引元数据、Performance Schema digest 和表/索引 I/O 统计，并核对主要查询的筛选、连接、排序、分页、更新与删除条件。

频率依据：Performance Schema 表/索引累计 COUNT_FETCH，不等同于 SQL 调用次数；应用参数化查询的 digest 覆盖不完整，慢查询日志未开启。本次未变更日志或监控配置。审计时 users 主键约 178451 次 fetch、document_collaboration 主键约 70285 次、files 两个旧单列索引合计约 639 次、projects 团队索引约 139 次、ai_models 用户索引约 138 次；这些是累计观测值，不是基准测试。

| 新索引 | 对应查询 | 验证结果 |
| --- | --- | --- |
| `files.idx_files_key_hash(file_key, hash)` | 附件读取/删除同时按 file_key 和 hash 筛选（repository/storage.go） | 新索引可用；当前仅 6 行，实际 EXPLAIN 仍选择 idx_hash，未测得实际提速 |
| `projects.idx_projects_team_order(team_id, created_at, id)` | 指定团队项目按创建时间与 ID 排序（repository/workspace.go:WorkspaceProjects） | 实际 EXPLAIN 使用新索引，消除 Using filesort |
| `ai_models.idx_ai_model_user_order(user_id, created_at, id)` | 指定用户模型按创建时间与 ID 排序（repository/ai.go:AIModels） | 实际 EXPLAIN 使用新索引，消除 Using filesort |

保留结论：账号与会话、团队/项目权限、按 key 读文档、协同状态和幂等回执、最近文件、AI 对话游标分页、文档历史列表/最近版本、回收站到期筛选和全文搜索已具备对应主键、唯一索引或范围索引。没有为低频空表列表重复增加排序索引。历史自动快照清理为每小时任务，现有 document_id 和 kind/created_at 索引已提供基础筛选，本次不增加低频专项索引。

发现但保留：`documents.idx_file_key(file_key)` 与唯一索引 `file_key(file_key)` 重复，本次未删除旧索引。`WorkspaceDocuments` 的 `%keyword%` LIKE 无法直接靠普通 B-tree 优化，改为全文检索涉及搜索语义变化，未改写。团队成员/团队列表的表达式排序、回收站 UNION ALL 后排序、窗口稀释排序不能仅靠本次普通联合索引消除。

迁移：显式执行 `internal/database/query-indexes.sql`，按索引名幂等，使用 ALGORITHM=INPLACE、LOCK=NONE 和 5 秒 metadata lock 等待上限。已在目标库执行并再次运行验证幂等；原有索引定义全部保留，数据库只增加上述 3 个索引。schema.sql 同步维护新建表定义。已有表的启动初始化仍只补表，后续其他环境应显式运行该迁移。当前在线服务无需重启；本次不替换已有预编译程序。

备份与回滚：服务器 `/root/voex-index-backup-20261105-164717` 内保存迁移前 schema、原始索引元数据、迁移前后 EXPLAIN、迁移后索引元数据、Git 状态和 rollback-indexes.sql。未生成、修改或运行单元测试。

在线 DDL 仍有短暂 metadata lock；语法及并发行为参考 [MySQL 8.0 Online DDL](https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl.html)。

全部表索引如下。P=主键，U=唯一，I=普通 B-tree，FT=全文索引；括号内字段顺序即索引顺序，全部索引均可见。

| 表 | 索引 |
| --- | --- |
| `ai_conversation_sessions` | I `fk_ai_session_document(document_id)`<br>I `idx_ai_sessions(user_id, document_id, id)`<br>P `PRIMARY(id)`<br>U `uq_ai_session(user_id, document_id, session_id)` |
| `ai_conversation_turns` | I `fk_ai_turn_document(document_id)`<br>I `idx_ai_conversation(user_id, document_id, id)`<br>I `idx_ai_session_turns(user_id, document_id, session_id, id)`<br>P `PRIMARY(id)`<br>U `uq_ai_turn(user_id, turn_id)`<br>U `uq_ai_turn_review(user_id, review_id)` |
| `ai_models` | I `idx_ai_model_user(user_id)`<br>I `idx_ai_model_user_order(user_id, created_at, id)` **新增**<br>P `PRIMARY(id)` |
| `ai_review_applications` | P `PRIMARY(user_id, review_id)` |
| `assets` | I `idx_asset_creator(creator_id)`<br>P `PRIMARY(id)` |
| `auth_sessions` | I `idx_session_expiry(expires_at)`<br>P `PRIMARY(id)`<br>U `refresh_hash(refresh_hash)`<br>I `user_id(user_id)` |
| `collaboration_commits` | I `idx_collab_commit_created(created_at)`<br>P `PRIMARY(document_id, commit_key)` |
| `collaboration_outbox` | P `PRIMARY(id)` |
| `document_access` | I `idx_document_access_user(user_id)`<br>P `PRIMARY(document_id, user_id)` |
| `document_collaboration` | P `PRIMARY(document_id)` |
| `document_sharing` | P `PRIMARY(document_id)` |
| `document_versions` | I `idx_document_versions_cleanup(kind, created_at)`<br>I `idx_document_versions_creator(created_by)`<br>I `idx_document_versions_doc(document_id, id)`<br>P `PRIMARY(id)` |
| `documents` | U `file_key(file_key)`<br>FT `ft_documents_search(file_name, file_content)`<br>I `idx_documents_creator(creator_id)`<br>I `idx_documents_deleted_by(deleted_by)`<br>I `idx_documents_folder(folder_id, created_at, id)`<br>I `idx_documents_folder_deleted(folder_id, deleted_at, created_at, id)`<br>I `idx_documents_trash_expiry(expires_at, id)`<br>I `idx_documents_updated_by(updated_by)`<br>I `idx_file_key(file_key)`<br>P `PRIMARY(id)` |
| `file_shares` | I `created_by(created_by)`<br>I `document_id(document_id)`<br>P `PRIMARY(id)`<br>U `token_hash(token_hash)` |
| `files` | I `idx_file_key(file_key)`<br>I `idx_files_creator(creator_id)`<br>I `idx_files_key_hash(file_key, hash)` **新增**<br>I `idx_hash(hash)`<br>P `PRIMARY(id)` |
| `folders` | U `folder_key(folder_key)`<br>I `idx_folders_deleted_by(deleted_by)`<br>I `idx_folders_order(project_id, created_at, id)`<br>I `idx_folders_parent(project_id, parent_id, created_at, id)`<br>I `idx_folders_project_deleted(project_id, deleted_at, created_at, id)`<br>I `idx_folders_trash_expiry(expires_at, id)`<br>P `PRIMARY(id)`<br>U `uq_folders_project_id(project_id, id)` |
| `project_members` | P `PRIMARY(project_id, user_id)`<br>I `user_id(user_id)` |
| `projects` | I `idx_projects_creator(creator_id)`<br>I `idx_projects_order(created_at, id)`<br>I `idx_projects_team(team_id)`<br>I `idx_projects_team_order(team_id, created_at, id)` **新增**<br>P `PRIMARY(id)`<br>U `project_key(project_key)` |
| `recent_files` | I `idx_recent_files_document(document_id)`<br>I `idx_recent_files_order(user_id, viewed_at, document_id)`<br>I `idx_recent_files_share(share_id)`<br>P `PRIMARY(user_id, document_id)` |
| `team_invites` | I `created_by(created_by)`<br>P `PRIMARY(id)`<br>I `team_id(team_id)`<br>U `token_hash(token_hash)` |
| `team_join_requests` | P `PRIMARY(id)`<br>I `reviewed_by(reviewed_by)`<br>U `uq_team_request(team_id, user_id)`<br>I `user_id(user_id)` |
| `team_members` | P `PRIMARY(team_id, user_id)`<br>I `user_id(user_id)` |
| `teams` | I `owner_id(owner_id)`<br>U `personal_owner_id(personal_owner_id)`<br>P `PRIMARY(id)`<br>U `team_code(team_code)`<br>U `team_key(team_key)` |
| `users` | U `account(account)`<br>P `PRIMARY(id)` |
| `workspace_state` | P `PRIMARY(id)` |

## SQL 表名与列名集中定义

`internal/dbschema` 直接使用 Go 文件维护表定义，不使用 JSON 清单、生成器或 `go generate`。按业务模块组织：

| 文件 | 定义范围 |
| --- | --- |
| `users.go` | 用户、登录会话 |
| `teams.go` | 团队、成员、邀请、加入申请 |
| `workspace.go` | 项目、项目成员、文件夹、工作区状态 |
| `documents.go` | 文档、历史版本、分享、授权、最近文件 |
| `storage.go` | 附件、资产 |
| `ai.go` | AI 模型、会话、轮次、审阅应用 |
| `collaboration.go` | 协同状态、提交回执、事件 |
| `catalog.go` | MySQL 系统目录 |
| `schema.go` | 包说明和通用列列表函数 |

查询使用局部表对象，优先不使用 SQL 别名或列前缀：

```go
dt := dbschema.Documents
query := db.Table(dt.Name).
    Select(dbschema.List(dt.Columns.ID, dt.Columns.FILE_KEY)).
    Where(dt.Columns.FILE_KEY+" = ?", fileKey)
```

上述查询使用 `documents` 与 `file_key`，不会生成 `d` 别名或 `documents.file_key`。Go 局部变量 `dt` 只是代码中的简写，不会成为 SQL 别名。

仅当 JOIN 的同名列需要消歧，或相关子查询需要明确外层字段时，使用 `Qualified()` 的字段，例如 `dq := dt.Qualified()` 后引用 `dq.Columns.ID`；`dq.Name` 仍是原表名。仅同表多次关联等必须区分实例时才用 `As()`。目前业务查询只在头像共同团队判断中保留 `owner_member`、`viewer_member` 两个表别名；派生表别名和计算结果别名按 SQL 语法及原返回字段保留。

迁移时直接修改对应 Go 文件中的字段声明、初始化与限定字段映射，并同步必要的 SQL 迁移和 model struct tags。旧字段引用可由编译检查发现。无需生成步骤，数据库 DDL 仍显式执行。

2026-11-06 调整验证：25 张业务表的 185 个字段、两个系统目录及既有 As 映射与调整前逐项一致；Go 编译通过。564 组查询对照（含鉴权/头像权限 CTE 边界）、54 条写入路径的 62 条 DryRun SQL 核对通过；回收站另完成 72 组真实库及 1,100 组只读 CTE 数据对照。未生成、修改或运行单元测试，未执行数据库迁移或重启服务。

本轮备份与诊断结果：`/root/voex-schema-layout-20261106-091607`。
