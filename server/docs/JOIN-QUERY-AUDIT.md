# JOIN 查询拆分审计（2026-11-05）

目标项目：服务器 `/home/voex-mono`；只读验证数据库：`voex-dev`（MySQL 8.0.46）。本轮只改 repository 查询层及本说明，不修改接口、UI、数据库结构或业务数据。

## 处理原则

能先按唯一键或主键确定记录，再在代码中判定和组装的点查，拆成多个索引查询。展示字段按关联 ID 去重后批量查询，不在结果行循环内访问数据库；每批最多 500 个关联键，空集合不发查询。复用调用方原事务和 context，不在事务中并发操作连接。

LEFT JOIN 的缺失关联保持 nil；INNER JOIN 的必要关联缺失时不返回该行。原主表排序和分页保持在 SQL 中，批量组装按主表切片顺序输出，不依赖 Go map 顺序，也不跨批次排序分页。

GORM builder 每批用 Session 克隆，避免上一个批次的 IN 条件污染下一批。使用现有索引；本轮未新增索引。

## 已拆分

| 范围 | 改后查询与组装 | 主要索引 |
| --- | --- | --- |
| 文档详情 DocumentByKey | 文档 key 点查 → 文件夹 → 项目 → 团队 → 批量作者/修改人；代码检查软删除及必要关联 | documents.file_key；folders/projects/teams/users 主键 |
| 文档列表、搜索、最近文件 | 主查询先完成可见性筛选/排序/分页，批量补作者和修改人；按 key 读取最近文档另外走 recent_files 复合主键 | users.PRIMARY；recent_files.PRIMARY(user_id,document_id) |
| 项目详情/列表 | projects 主查询后批量补 teams 信息 | project_key/PRIMARY；idx_projects_team_order；teams.PRIMARY |
| 团队成员身份 | 团队 key 点查后按 team_id/user_id 查 membership，仍要求 owner 有 membership 才能返回 | teams.team_key；team_members.PRIMARY |
| 团队列表/成员列表 | 主表保持原 SQL 排序；批量补团队、用户及分组成员计数，在代码覆盖 owner 角色 | team_members.user_id/PRIMARY；teams/users.PRIMARY |
| 团队申请 | 申请主查询保持原排序，批量补 teams/users，删除组装用的临时 team_id | team_join_requests.PRIMARY/user_id/uq_team_request；teams/users.PRIMARY |
| 附件及文档授权名单 | files/document_access 主查询后按 users.id IN 批量补字段 | files.idx_file_key；document_access.PRIMARY；users.PRIMARY |
| AI 历史 | 轮次分页后批量补文档 key，以及仅限当前 user_id 的已应用 review 标记；保留附件内容裁剪 | idx_ai_session_turns、uq_ai_turn、uq_ai_turn_review；documents.PRIMARY；ai_review_applications.PRIMARY |
| 文档历史版本 | 主查询完成 document_id/游标分页后批量补创建人 | idx_document_versions_doc；users.PRIMARY |
| 回收站详情 | folder/document key 点查后依次读取关联并组装 | folder_key/file_key；folders/projects.PRIMARY |
| 回收站列表 | 先批量查询项目/团队并校验必要关联；无 JOIN 的 UNION 保留全局计数/排序/分页，文档通过文件夹索引子查询限定项目；当前页批量补路径、删除人、恢复条件和文档数 | projects/teams/folders/users.PRIMARY；folders.project_id 左前缀索引；documents.folder_id/回收站到期索引 |
| 批量回收站文档 | 按 project_id 取 folders，再按 folder_id IN 分块取已删 documents，Go 补 folder_deleted_at | folders.project_id 左前缀索引；documents.folder_id 左前缀索引 |

## 保留的 JOIN

- 项目权限 WorkspaceProjectPermission：现有列表会逐项调用该查询，拆成四次点查将放大往返；保留原主键/唯一键 JOIN 和 EXISTS。
- 登录会话与 refresh 查询：各表实测均命中主键或 refresh_hash 唯一索引；service 当前直接 autocommit 调用。保留单语句一致性，并避免每次鉴权增加事务及查询往返。
- AccessibleAsset：资产主键锚定单行；当前头像引用和共同团队权限需在同一语句快照判断。原调用无显式事务，保留 EXISTS 内的两个 JOIN。
- TeamByInvite：邀请撤销状态与团队读取在同一语句中判断；InspectTeamInvite 无事务，保留。
- DocumentQuery 的 folders/projects/teams、RecentFiles 的 recent_files：参与可见性或分页前筛选。回收站 UNION 内的层级 JOIN 已全部拆除，改为分页前校验项目/团队、folders 索引子查询及分页后批量补充。
- 历史迁移 document-access.sql 的三个 JOIN：属于一次性授权回填，INSERT SELECT 的原子性和可重复升级规则保持不变，不改写为业务代码循环。

## 验证与限制

- `go build -mod=readonly` 通过，`gofmt` 和相关文件 `git diff --check` 通过。
- 使用迁移前源文件快照构建只读诊断命令，新旧实现放在同一个 READ ONLY / REPEATABLE READ 数据库事务中对照，508 组结果全部一致。对照包含字段与 nil、原排序、多个 limit/cursor/offset、缺失记录及空集合；无业务数据写入。
- 当前数据覆盖 2 个用户、2 个团队、12 篇文档、9 个 AI 会话、28 个 AI 轮次、23 个文档版本；团队申请为 0 行，因此申请非空列表未得到真实数据覆盖，只有编译、静态复核和空结果验证。
- 拆分查询已做 EXPLAIN：文档 key、层级主键、成员复合主键、用户批量主键、团队项目排序索引、附件 file_key、历史版本游标索引、AI 会话轮次索引、review 复合主键和 folder_id 分组计数均有索引支持。空 project_members 的非空访问路径未得到真实数据覆盖。document_access 的 granted_at 排序仍有 Using filesort，保留原行为。
- 未生成、修改或运行单元测试。临时诊断源码目录已清理；诊断二进制、源文件、旧源码与 EXPLAIN 结果保存在 `/root/voex-join-backup-20261105`。
- 本轮未替换运行中的服务二进制、未重启服务。服务器工作区中其他正在产生的改动未被回退或覆盖。
- 拆分会增加数据库往返。既有服务层逐项 ProjectPermissions 循环本轮未扩展重构；已保留 WorkspaceProjectPermission 的原索引 JOIN，避免额外放大该循环的 SQL 数量。当前未做负载基准，不能声称整体吞吐或响应耗时已经改善。

一致性依据：[MySQL 8.0 Consistent Nonlocking Reads](https://dev.mysql.com/doc/refman/8.0/en/innodb-consistent-read.html)。普通业务调用沿用既有 REPEATABLE READ 事务；协同提交沿用 READ COMMITTED 事务及 workspace SHARE/文档锁，未改变隔离级别或锁顺序。

## GORM JOIN 调用点

统计为静态 Joins 调用点，不等同于一次接口请求的 SQL JOIN 次数。AccessibleAsset 的原生 SQL JOIN 和历史迁移 JOIN 单独按上文保留。

| 文件 | 修改前 | 修改后 |
| --- | ---: | ---: |
| `ai_history.go` | 2 | 0 |
| `auth.go` | 2 | 2 |
| `document_versions.go` | 1 | 0 |
| `recent.go` | 1 | 1 |
| `shares.go` | 2 | 0 |
| `storage.go` | 1 | 0 |
| `teams.go` | 6 | 1 |
| `trash.go` | 11 | 0 |
| `workspace.go` | 8 | 5 |
| 合计 | 34 | 9 |

减少 25 个 GORM JOIN 调用点。

## trashListQuery 追加拆分

- 原 documents 分支的 3 个 JOIN、folders 分支的 2 个 JOIN 全部移除；TrashList 对项目 ID 去重后分批读取 projects/teams，在计数和分页前排除缺少团队的项目，保留原 INNER JOIN 语义。
- documents.folder_id 通过 `IN (SELECT id FROM folders WHERE project_id IN (...))` 限定范围，不将整个项目的文件夹 ID 列表加载到 Go 内存。该 SQL 保留索引子查询；未改成分页后过滤。
- UNION 只返回主记录及临时 related_folder_id，COUNT、删除人条件、到期条件、全局排序、limit/offset 继续由数据库执行。页内按 folders 主键批量读取路径和父文件夹删除状态，并组装原字段；related_folder_id 返回前删除。
- 文件夹文档计数仍包含其下未删除、已删除和已过期文档，与旧行为相同；document 行的 document_count 保持 nil。缺失删除人保持 nil。
- 最终 Go 编译、gofmt、diff 空白检查通过。72 组真实库只读结果对照通过；真实库当前无已删除记录，因此另以 SELECT-only CTE 在数据库中构造多种边界，1,100 组新旧结果对照全部一致，其中 600 组总数非零。覆盖跨类型全局分页、重复/无效项目、空团队/缺失关联、删除人缺失、NULL/过期条件、can_restore、文档计数及 513 个项目 key 的跨批查询。
- CTE 对照在同一 READ ONLY / REPEATABLE READ 事务运行，不创建表、不改业务数据；未生成、修改或运行单元测试。EXPLAIN 显示真实库文档分支使用 idx_documents_trash_expiry、文件夹范围有 project_id 左前缀索引支持，项目/团队/页内文件夹读取使用主键；UNION 全局排序保留原行为。
- 本次备份、只读诊断源码/二进制和 EXPLAIN 保存于 `/root/voex-trash-list-backup-20261105-171611`。运行中的服务未重启。
