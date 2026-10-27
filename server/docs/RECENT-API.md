> 当前权限、固定分享与回收站规则以 [PERMISSIONS.md](PERMISSIONS.md) 为准，旧版本描述不再作为鉴权依据。

# 最近文件

所有 `/api/recent-files` 接口要求登录，并只访问当前账号的记录。成功 GET 文档正文或分享文件时自动记录；HEAD、列表、详情、保存和附件读取不产生查看记录。匿名分享访问不记入账号历史。

## 列表

`GET /api/recent-files?limit=N` 返回 `{ items, total, limit: N }`。`limit` 由前端决定且必填；后端只校验它是可表示的正整数，不设固定业务上限或默认值。缺失、重复、非整数、非正数或超出整数表示范围返回 400。当前页面传 `40`；调用方传 `60` 时返回并保留最近 60 条。数据不足 N 条时返回现有记录，`total` 为实际返回条数，不再分页或统计全部历史。排序为 `viewed_at DESC, document_id DESC`；同一个账号的同一文件只有一条记录，重开更新查看时间。旧 URL 中的 `page` 参数不影响结果。

列表查询最多读取 N+1 条来判断是否超出请求条数（整数最大值不再加一，避免溢出）。GET 响应写出并 flush 后，若发现超量，后台异步清理该账号第 N 条之后的记录；HEAD 不触发清理。清理重新计算最新边界，并复用写事务锁，与并发查看、移除操作互斥，避免依据响应时的旧快照误删刚查看的记录。相同查看时间按 document_id 确定先后。

同一进程对同一账号、相同 limit 合并进行中的清理任务；不同 limit 各自按本次参数执行，避免参数变化被已有任务忽略。清理使用独立的 10 秒超时 context，不因请求结束而取消。清理只影响查看记录，失败不影响已返回的数据或服务进程，记录日志并在下次超量列表请求后重试。数据库记录数在新增访问到清理完成期间可能暂时超过 N，接口始终只返回最多 N 条。增大 limit 不会恢复已经清理的历史记录。

每项包含 `file_key`、`file_name`、`viewed_at`、`access`、`path` 和 `permissions: {read,write,manage,share}`。`access` 为 `project`、`share` 或 `unavailable`。项目权限优先，分享只赋予指定文件的只读或正文编辑能力，不扩展为项目成员、目录访问、重命名、删除或再次分享权限。

仍有文件读取权限的项追加 `created_at`、`updated_at`、`updated_by` 和 `updated_by_kind`，含义与[文件详情](FILE-DETAILS-API.md)一致。`path` 仅在 `access=project` 时包含 `{team_key,project_key,project_name,folder_key,folder_name}`；`share` 和 `unavailable` 均为 null。没有读取权限的项不返回创建时间、修改时间或修改人等当前元数据。

分享撤销或用户退出项目后重新检查权限；无权限项仅返回查看时的名称快照与时间，保留移除记录的能力，不返回最新名称或正文。原文件删除时，记录通过外键自动清理。

## 打开、保存、附件

`GET /api/recent-files/:fileKey` 返回与分享阅读页相同的单文件 DTO 和附件清单，不带父目录或其他文件信息。授权来自当前账号的项目权限，或其访问记录绑定且仍有效的分享 ID；不接受客户端指定分享 ID 来取得授权。不存在本人的记录返回 404，授权失效返回 403。

`PUT /api/recent-files/:fileKey` 仅接受 `{ file_content: string, revision: number }`。读取和保存均重新鉴权，版本过期返回 409。附件通过 `/api/recent-files/:fileKey/attachments/:hash` 下载，沿用 Range 与 HEAD，且校验附件确实属于该文件。保存和下载不更新历史时间。

`GET/HEAD /api/recent-files/:fileKey/details` 只读取当前文件详情，不读取正文或附件，不更新最近访问排序。没有项目权限时不返回文件路径。完整响应见[文件详情](FILE-DETAILS-API.md)。

## 移除

`DELETE /api/recent-files/:fileKey` 幂等返回 `{ success: true }`。只删除当前账号的查看记录，不要求文件写权限，不删除文档、附件、分享，也不影响其他账号的记录。再次从项目或有效分享链接打开文件会重新产生记录。移除后不能再凭该记录访问分享文件，需要重新打开原链接。

## 数据库结构

`recent_files` 定义位于 `internal/database/schema.sql`，空库需手动初始化。查看记录从成功文件读取开始产生，不回填历史访问。原始分享 token 不存入查看记录或客户端持久存储。

文件修改人字段也定义于完整初始化 SQL；没有记录修改人的历史文件显示“未记录”。

## 文件权限更新（2026-10-23）

登录用户 GET 有效分享链接后，按账号与文件保存 read/edit 权限，权限只升级、不因新的只读访问降级。删除最近记录和撤销分享链接不收回已有账号授权；撤销只阻止新的链接访问。匿名访问不写入账号授权。

普通 `/api/document/:fileKey`、附件、AI、分享接口统一识别该授权，编辑页无需携带分享令牌或来源参数。文件 DTO 的 permissions 包含 read/write/manage/share/remove；编辑者的文件功能与创建者一致，只有创建者的 remove 为 true。删除 API 单独校验创建者，父级级联和永久删除同样不能绕过该限制。文件授权不增加项目/团队管理权，目录只返回该用户可访问的文档及其所属文件夹。
