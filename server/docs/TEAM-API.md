> 当前权限、固定分享与回收站规则以 [PERMISSIONS.md](PERMISSIONS.md) 为准，旧版本描述不再作为鉴权依据。

# Teams and sharing (experimental)

Current contract: users join multiple teams as owner/admin/member. Each user has exactly one personal team, created transactionally with registration. Personal teams allow members and projects, but cannot be deleted or transferred; their owner cannot leave.

Teams -> projects -> one level of folders -> documents. The initialization SQL in `internal/database/schema.sql` includes team ownership, memberships, privileges JSON, project membership lists, join requests, invitations, shares, and document revision. Initialize an empty database manually before starting the server; existing databases are maintained explicitly.

Owner/admin always edit every project. Members edit inherit-mode projects or projects listing them explicitly. An empty restricted list grants access only to owner/admin. Every team member can create a project; creating folders/documents requires edit permission in that project. Creator remains authorship metadata.

privileges describes policy; permissions describes effective request capabilities. Folders always inherit. Project privilege settings require owner/admin. Project editors can rename/delete empty projects. Team ownership transfer is owner-only, standard teams only; previous owner becomes admin.

/api/teams: GET list, POST create.
/api/teams/:key: GET, PATCH name, DELETE empty standard team (owner).
/api/teams/:key/members: GET; /:userId PATCH role (owner), DELETE remove/leave.
/api/teams/:key/transfer: POST {user_id}.
/api/teams/:key/invites: GET/POST; /:id DELETE revoke.
/api/team-invites/inspect: POST {token}, public minimal team preview.
/api/team-join-requests: POST {team_code or invite_token,message}, GET own requests.
/api/teams/:key/join-requests: GET; /:id PATCH {status:approved or rejected}.
Applications use 1-1000 trimmed Unicode codepoints. Pending submissions are idempotent. Reapplying after a processed request generates a new id to prevent stale approval.

/projects?team_key=... lists authorized projects in selected team. /project POST {name,team_key}. /project/:key/privileges GET/PUT {mode:inherit or restricted,user_ids:[]}.
/document/:key PUT content requires current revision; only content changes increment it. Revision mismatch is HTTP409. Name-only changes keep revision.
/document/:key/shares GET/POST {permission:read or edit}; /:id DELETE revoke. Only project members may create shares; managers revoke any, ordinary members revoke own.

Browser links use /share#TOKEN or /join#TOKEN. Tokens are generated from 32 random bytes, stored only as SHA256 hashes. Invitation links still require application and review.
/shared-file GET/PUT uses X-Share-Token header and optional JWT. Any valid link holder can access that document only. Edit links allow anonymous content edits. Project edit rights override read links. Public PUT only accepts file_content and revision. No team/project/folder identifiers or contact details are exposed.
/shared-file/attachments/:hash GET binds file_key+hash to the shared document. /shared-file/creator-avator is capability-scoped. Revocation takes effect on the next request. General /assets/upload and document /upload still require JWT; links never grant general upload or project access.

Implementation: internal/handler/{teams,workspace,shares}.go, with service/repository counterparts. Configuration, build, deployment and verification are documented in README.md.

## 文件权限更新（2026-10-23）

登录用户 GET 有效分享链接后，按账号与文件保存 read/edit 权限，权限只升级、不因新的只读访问降级。删除最近记录和撤销分享链接不收回已有账号授权；撤销只阻止新的链接访问。匿名访问不写入账号授权。

普通 `/api/document/:fileKey`、附件、AI、分享接口统一识别该授权，编辑页无需携带分享令牌或来源参数。文件 DTO 的 permissions 包含 read/write/manage/share/remove；编辑者的文件功能与创建者一致，只有创建者的 remove 为 true。删除 API 单独校验创建者，父级级联和永久删除同样不能绕过该限制。文件授权不增加项目/团队管理权，目录只返回该用户可访问的文档及其所属文件夹。
