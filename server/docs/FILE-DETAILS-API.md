> 当前权限、固定分享与回收站规则以 [PERMISSIONS.md](PERMISSIONS.md) 为准，旧版本描述不再作为鉴权依据。

# 文件详情

详情接口只读取元数据，不读取正文或附件，也不新增、更新最近访问记录。GET 和 HEAD 都要求登录，并在本次请求的事务内重新校验权限。

| 接口 | 授权与错误 |
| --- | --- |
| `GET/HEAD /api/document/:fileKey/details` | 要求当前账号对所属项目有读取权限；文档不存在或项目不可访问时返回 404。 |
| `GET/HEAD /api/recent-files/:fileKey/details` | 要求存在本人的最近记录，并拥有当前有效的项目权限或该记录绑定的分享权限；记录不存在返回 404，权限失效返回 403。 |

成功返回以下 DTO，时间使用与其他文档接口相同的 UTC 字符串；历史数据库中的空时间返回空字符串。

```ts
interface FileDetails {
  file_key: string
  file_name: string
  created_at: string
  updated_at: string
  updated_by: { id: string; name: string } | null
  updated_by_kind: 'user' | 'anonymous' | 'unknown'
  access: 'project' | 'share'
  permissions: { read: boolean; write: boolean; manage: boolean; share: boolean }
  path: {
    team_key: string
    project_key: string
    project_name: string
    folder_key: string
    folder_name: string
  } | null
}
```

`path` 仅在当前项目 `read` 权限为 true 时返回。通过分享读取但没有项目权限时，`access` 为 `share`、`path` 为 null，响应中不会出现项目或文件夹标识、名称。项目权限优先于分享权限。

前端可将路径显示为 `/{project_name}/{folder_name}/{file_name}`：项目段进入项目，文件夹和文件段进入所属文件夹。跳转前重新读取详情以校验当前权限，不能用历史列表中的路径作为授权依据。

修改人随文件操作记录：新建文件记录创建者；成功的重命名、正文保存，以及分享或最近文件入口保存，均在同一个写事务内更新修改人与修改时间。只有正文保存递增 revision；鉴权失败或版本冲突不会改写修改人。

| 情况 | `updated_by_kind` | `updated_by` |
| --- | --- | --- |
| 已登录用户创建或最后修改 | `user` | 该用户的 ID 与当前显示名称 |
| 最后一次通过编辑分享匿名修改 | `anonymous` | null，前端显示“匿名用户” |
| 未记录修改人的历史文件，尚未产生新修改 | `unknown` | null，前端显示“未记录” |

历史修改人不从创建人推断或回填。匿名修改会清除上一次登录修改人的关联，避免把匿名操作归到先前用户。

## 文件权限更新（2026-10-23）

登录用户 GET 有效分享链接后，按账号与文件保存 read/edit 权限，权限只升级、不因新的只读访问降级。删除最近记录和撤销分享链接不收回已有账号授权；撤销只阻止新的链接访问。匿名访问不写入账号授权。

普通 `/api/document/:fileKey`、附件、AI、分享接口统一识别该授权，编辑页无需携带分享令牌或来源参数。文件 DTO 的 permissions 包含 read/write/manage/share/remove；编辑者的文件功能与创建者一致，只有创建者的 remove 为 true。删除 API 单独校验创建者，父级级联和永久删除同样不能绕过该限制。文件授权不增加项目/团队管理权，目录只返回该用户可访问的文档及其所属文件夹。
