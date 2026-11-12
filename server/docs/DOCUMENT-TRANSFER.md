# 文档导入导出

## 范围与权限

单文档导入到指定项目/文件夹并新建，不覆盖现有文档。仅接受 UTF-8 单个 `.md` 或原生 `.voex`，不接受 Markdown ZIP。导入要求登录且目标位置可写；新文档继承目标权限。导出要求登录且文档可写，生成与下载时均重新校验；只读成员、匿名分享访问者不能导出。

原生包迁移当前正文结构和关联附件，不恢复旧文档标识、作者身份、权限、分享、历史或 Yjs 客户端身份。外链保留 URL，不抓取网络资源。缺失附件保留正文和可用附件并返回警告；已有文件字节与清单不符属于损坏包，拒绝导入。

## HTTP 接口

所有接口位于受登录保护的 `/api` 下。

- `POST /document/:fileKey/export`，JSON `{ "format": "voex" | "markdown", "preserve_styles": false }`。返回 `{ export_id, file_name, download_url, warnings }`。
- `GET /document-exports/:exportID`，下载已生成的 ZIP 字节。原账号且仍有文档写权限才可下载。
- `DELETE /document-exports/:exportID`，原账号幂等释放临时包。客户端获取完整 Blob 后、关闭结果或重新导出时调用；下载失败时保留票据供重试。
- `POST /document/import`，multipart 字段 `file`、`project_key`、`folder_key`（可空）、`request_id`。返回 `{ document, warnings }`；document 含新文档 key、名称、位置、creator 和 replayed。

警告形状为 `{ code, message, name?, source? }`。相同类型、名称、来源只报告一次。前端保留完整结果列表，不能只显示短暂 toast。导入选择文件时生成 request_id，失败/取消后重试保留同一个 ID；相同账号、请求 ID、输入字节及目标位置得到同一文档，不重复创建。重新选择文件建立新的导入请求。取消等待不保证数据库尚未提交，重试用于确认同一次结果。

## 原生包 v1

文件扩展名为 `.voex`，无附件时仍为 ZIP：

```text
manifest.json
document.json
assets/<sha256>.<extension>
```

manifest 字段：

```json
{
  "format": "voex",
  "format_version": 1,
  "schema_version": "voex-editor-1",
  "title": "文档标题",
  "assets": [
    {
      "hash": "64位小写SHA-256",
      "path": "assets/包内文件名",
      "name": "原文件名",
      "mime": "application/octet-stream",
      "size": 123,
      "missing": false
    }
  ]
}
```

document.json 是当前共享 schema 的 ProseMirror JSON。图片、卡片、附件链接中的内部地址规范化为 `/api/download/__voex_archive__/<hash>`；导入重写为新文档 key。附件节点继续使用 hash。相同内容对象只写一份，清单可保留不同显示名的关联记录。

清单标记 missing 或实际条目不存在均返回缺失提示，不从服务器同 hash 的其他文档借用文件。未在清单中列出的正文附件引用同样保留并提示缺失。未知 schema 版本、未知节点/属性、冲突路径、大小或 hash 错误均拒绝；所有预检成功后一次事务创建正文、协作状态及有效附件记录。

导出从同一数据库快照读取元数据、Yjs、Markdown 投影和附件记录；前端先等待协作 flush 落库。协作文档从 Yjs 提取节点，legacy 文档使用共享 parser。归档生成在事务外执行，不持有长时间工作区写锁。

## Markdown 交换格式

输出 ZIP 包含标题命名的 Markdown 和正文引用的附件目录；存在警告时另含 export-report.json。内部附件路径使用安全文件名与内容 hash，Markdown 链接对路径字符编码。未引用附件不进入 Markdown ZIP。

- CommonMark、GFM 表格/任务列表/删除线、脚注按语义保留。
- 图片（包括图片附件与卡片封面）使用标准 Markdown 图片语法；普通文件、音视频附件使用链接。
- 卡片按顺序展开图片和文字，舍弃布局。
- 块公式输出 `$$`；Mermaid 保留 fenced code；行内公式保留源码。
- 默认去掉颜色、高亮、字号；开启 preserve_styles 后以白名单 span 样式保留。font-family 始终移除，不打包字体。
- 图片尺寸/对齐和表格列宽不保留；合并单元格表格按内容展开并提示。
- 未识别 HTML 保留为源码文字，不执行。导入支持本功能输出的白名单文字样式。
- 单个 MD 无法带入相对路径图片或文件，保留引用并警告；外链不下载。导出同样提示未打包的本地引用。

Markdown 是内容交换格式，不保证恢复原始布局；原生 JSON 保留当前支持的结构和属性。

## 限额与生命周期

- MD 输入与持久化 Markdown：2 MiB；正文 JSON、Yjs 状态：16 MiB。
- Voex 压缩文件：512 MiB；完整展开总量：1 GiB；单附件：300 MiB。
- manifest：2 MiB；ZIP 条目：2000；附件记录：1900。
- 全局最多 2 个处理中任务；每账号最多 2 个未释放导出，全局最多 8 个。
- 导出完成后保留 15 分钟；失败或取消清理未发布临时包。客户端应调用 DELETE 释放已下载结果。
- 归档处理拒绝越界、绝对、符号链接及冲突路径。校验后才发布文件关联；失败不删除其他文档共享的 hash 对象。

转换由现有协作 Node 服务中的受共享密钥保护的 `/internal/collab/transfer` 提供。需要开启协作服务；Go 不另写 Markdown parser，也不升级 schema 的日常保存格式。

## 验证方式

使用类型检查、构建、静态检查、隔离 MySQL/存储目录中的合成文档 HTTP 往返与浏览器交互验收。遵循项目约束，不生成或运行单元测试。
