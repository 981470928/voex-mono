# 当前权限与分享规则

本文件是当前权限契约，优先于其他文档中旧的创建者权限、随机分享链接与继承编辑描述。

## 团队与项目

所有者、管理员可创建项目；普通成员不能创建项目，包括创建文件时的默认项目回退。所有团队成员默认可读全部项目；所有者、管理员自动拥有全部项目编辑权限，普通成员由 project_members 明确授予项目编辑权限。新建项目默认 restricted；不再支持 inherit 自动向全部成员开放编辑。

项目编辑权限允许创建文件/文件夹、编辑项目内容及管理文件分享。单文件编辑授权不能扩大项目权限。项目删除仅允许所属团队所有者；文件/文件夹删除允许所属团队所有者、管理员及具有该项目编辑权限的成员。不再按文件创建者判断删除或隐式授予读写。个人团队仍不可删除、转移。

所有者独占设置管理员、转移所有者与删除团队；管理员不能移除所有者或其他管理员。角色权限仅在所属团队内生效，不授予他人私人账号或 AI 密钥访问权。

## 文件授权

文件有效读写取项目基础权限与 document_access 的最高值。write 控制文件编辑与分享入口；manage 控制分享开关和授权管理，必须有项目 write；remove 取项目 children_remove，单文件授权永不授予删除权。

已拥有项目编辑权限的用户访问分享链接，不写 document_access；项目只读成员访问编辑链接获得单文件 edit，可被项目编辑者取消。其他账号按链接获 read/edit，普通访问只升级不降级。删除授权是显式操作，可撤回 edit；团队成员回退项目只读，非成员失去独立授权。最近记录不再补充权限。

授权管理只列出非团队成员的 read/edit，以及项目只读成员的额外 edit。不能取消项目或团队提供的权限。被剔除后若链接仍开启，再次访问可以重新获权，不设置屏蔽名单。

## 固定分享

每个文件固定 read/edit 两个签名链接。token 为 v1.fileKey.mode.signature，signature 用独立持久化 SHARE_SECRET_FILE 的 HMAC-SHA256 计算，绑定文件与模式；不能通过改变 read 为 edit 获取编辑链接。凭证仍位于 URL fragment，通过 X-Share-Token 访问公开读取接口。

document_sharing 独立保存 read_enabled/edit_enabled，默认关闭。开启时匿名可读，编辑链接提供登录入口；登录账号按上述规则获得权限。关闭时不新增或升级授权，已有项目/文件读取权限仍可访问，否则返回403“你没有权限”。已拥有编辑权限的人进入不带 query/hash 的 /app/edit/:file_key。

旧随机 token 不再支持，旧 file_shares 表仅保留历史/迁移依据，不参与运行时访问检查。旧公共 PUT /api/shared-file 继续关闭。

接口：GET /api/document/:key/sharing（文件 write）；PATCH 同路径 {permission,enabled}（项目 write）；DELETE /api/document/:key/access/:userId（项目 write）。读取返回 links、can_manage、access；无管理权限不返回授权名单。

## 回收站

所有者/管理员看到所属团队所有项目的回收记录；普通成员只看到 deleted_by 为自己的文件和文件夹。列表包含 can_restore/can_purge；普通成员还必须保有当前项目编辑权限才能恢复/彻底删除，失去编辑权仍可看自己的记录。

POST /api/trash/restore-all 与 DELETE /api/trash 仅限所有者/管理员，按 team_key 和可选 project_key 操作全部符合范围的记录，不受分页影响。恢复全部先恢复未过期文件夹再恢复可恢复文件；清空包含回收文件夹内部内容。普通恢复/永久删除同样逐次校验身份、项目权限和删除者，不能通过直接调用越权。

## 前端

无项目编辑权时隐藏创建文件/文件夹入口；无团队管理角色时隐藏创建项目。最近文件和文件列表仅对文件 write 展示分享菜单。文件编辑者可查看/复制已开启固定链接；只有项目编辑者可操作开关和授权名单。回收站批量按钮仅管理者显示。

## 部署

已有数据库显式执行 internal/database/permission-refactor.sql。新增 document_sharing，根据旧有效链接初始化两个开关；旧项目 inherit 配置迁为 restricted，保留已有明确的 project_members 编辑授权。保留 document_access 中已有独立授权，不根据当前团队角色猜测并删除历史授权。备份并持续保留 SHARE_SECRET_FILE；丢失或替换密钥会改变固定链接。

不运行单元测试；使用编译、静态检查、隔离数据库实际 HTTP 与浏览器联调验证。
