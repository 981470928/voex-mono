> 当前权限、固定分享与回收站规则以 [PERMISSIONS.md](PERMISSIONS.md) 为准，旧版本描述不再作为鉴权依据。

# 数据库

Go 服务通过 GORM / `gorm.io/driver/mysql` 访问 MySQL 8，驱动版本固定于 `go.mod`。连接参数为 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`；不在文档保存真实密码。服务连接配置指定的已有数据库。

## 初始化与连接

服务默认运行 `serve`，只建立数据库连接，不自动建库、建表或执行 DDL。新环境先手动创建 MySQL 8 空库，再通过 MySQL 客户端把 `internal/database/schema.sql` 导入该库；连接参数对应上述 `MYSQL_*` 配置。该 SQL 是当前完整结构，按外键依赖顺序建表，最后写入 `workspace_state.id=1` 的工作区锁记录。

初始化脚本仅适用于空库，遇到已有同名表会报错；不用于更新已有业务库。当前开发阶段由开发者显式维护结构变化，并同步更新初始化 SQL。运行时代码不读取或写入迁移账本。

连接池最多 10 个连接，查询和事务绑定请求 context，业务事务使用 REPEATABLE READ；没有 GORM `AutoMigrate`。日常服务只需业务表读写权限。

`documents.updated_by=null`、`updated_by_anonymous=false` 表示未记录修改人；匿名分享修改为 null / true，登录修改为用户 ID / false。

## 表与业务一致性

| 表                                                  | 用途                                                   |
| --------------------------------------------------- | ------------------------------------------------------ |
| `users`、`auth_sessions`                            | 账号、Argon2id 密码哈希、用户自定义 JSON 配置与登录会话 |
| `teams`、`team_members`                             | 团队、个人团队与成员角色                               |
| `team_invites`、`team_join_requests`                | 邀请凭证哈希与入队审批                                 |
| `projects`、`project_members`、`folders`            | 团队项目、授权与单层文件夹                             |
| `documents`                                         | Markdown 正文、目录、最后修改人、revision 与软删除状态 |
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

已有环境部署前显式执行 `internal/database/document-access.sql`；该脚本创建新表，并从仍有效的已访问分享记录回填授权，重复执行不会把 edit 降为 read。新环境的 schema.sql 已包含此表。运行时仍不自动执行 DDL。

## 协同正文

可选协同模块新增 documents.content_mode、document_collaboration（二进制当前状态）、collaboration_commits（7 天提交幂等回执）与 collaboration_outbox（事务事件）。已有库先备份停写，再显式执行 collaboration.sql；空库 schema.sql 已包含新结构。Yjs 状态与 Markdown 投影、revision 在同一事务提交；详情见 [多人协同](COLLABORATION.md)。
