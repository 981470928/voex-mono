package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"
	"voex-server/internal/service"
	"voex-server/internal/shared"
	"voex-server/internal/transport"

	"github.com/gin-gonic/gin"
)

func (h *Handler) RegisterWorkspaceRoutes(protected *gin.RouterGroup) {
	// GET/HEAD /api/projects：列出当前用户可访问的项目；需要登录。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/projects", h.workspaceListProjects)
	// POST /api/workspace/initialize：初始化并读取指定团队工作区；需要登录。
	protected.POST("/workspace/initialize", h.workspaceInitialize)
	// POST /api/project：创建项目及默认文件夹；需要登录。
	protected.POST("/project", h.workspaceCreateProject)
	// PUT /api/project/:projectKey：重命名有写入权限的项目；需要登录。
	protected.PUT("/project/:projectKey", h.workspaceRenameProject)
	// DELETE /api/project/:projectKey：删除项目；有子项时需 cascade=true 确认级联删除，需要写入权限。
	protected.DELETE("/project/:projectKey", h.workspaceDeleteProject)
	// GET/HEAD /api/project/:projectKey/tree：读取项目、文件夹和文档目录；需要登录。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/project/:projectKey/tree", h.workspaceProjectTree)
	// POST /api/folder：在项目内创建一层文件夹；需要登录。
	protected.POST("/folder", h.workspaceCreateFolder)
	// PUT /api/folder/:folderKey：重命名文件夹；需要登录。
	protected.PUT("/folder/:folderKey", h.workspaceRenameFolder)
	// DELETE /api/folder/:folderKey：删除文件夹；有子项时需 cascade=true 确认级联删除，需要写入权限。
	protected.DELETE("/folder/:folderKey", h.workspaceDeleteFolder)
	// GET/HEAD /api/project/:projectKey/privileges：读取项目成员权限策略；需要登录且具有管理权限。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/project/:projectKey/privileges", h.workspaceProjectPrivileges)
	// PUT /api/project/:projectKey/privileges：设置继承或指定成员权限；需要登录且具有管理权限。
	protected.PUT("/project/:projectKey/privileges", h.workspaceSetProjectPrivileges)
	// POST /api/document：创建文档并解析所属项目和文件夹；需要登录。
	protected.POST("/document", h.workspaceCreateDocument)
	// GET/HEAD /api/document/:fileKey：读取文档正文、元数据和权限；需要登录。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/document/:fileKey", h.workspaceGetDocument)
	// GET/HEAD /api/document/:fileKey/details：只读取文件详情及可访问路径，不记录最近访问。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/document/:fileKey/details", h.workspaceGetDocumentDetails)
	// PUT /api/document/:fileKey：修改文档名称或按版本保存正文；需要登录。
	protected.PUT("/document/:fileKey", h.workspaceUpdateDocument)
	// DELETE /api/document/:fileKey：删除文档及附件关联；需要登录。
	protected.DELETE("/document/:fileKey", h.workspaceDeleteDocument)
	// GET/HEAD /api/documents：按名称搜索当前用户可读文档的元数据；需要登录。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/documents", h.workspaceListDocuments)
}

func workspaceOptionalKey(body shared.Row, field, label string) string {
	value, present := body[field]
	if !present {
		return ""
	}
	return shared.Key(value, label)
}

func workspaceQueryValue(c *gin.Context, field string) (any, bool) {
	values := c.Request.URL.Query()
	if entries, present := values[field]; present {
		if len(entries) != 1 {
			return entries, true
		}
		return entries[0], true
	}
	for key := range values {
		if strings.HasPrefix(key, field+"[") {
			return []any{}, true
		}
	}
	return nil, false
}

func workspaceDeleteCascade(c *gin.Context) bool {
	query, err := url.ParseQuery(c.Request.URL.RawQuery)
	if err != nil {
		shared.Fail(400, "删除参数格式错误")
	}
	for key := range query {
		if strings.HasPrefix(key, "cascade[") {
			shared.Fail(400, "cascade 只能是单个 true 或 false")
		}
	}
	values, present := query["cascade"]
	if !present {
		return false
	}
	if len(values) != 1 || (values[0] != "true" && values[0] != "false") {
		shared.Fail(400, "cascade 只能是单个 true 或 false")
	}
	return values[0] == "true"
}

// 初始化兼容历史接口的空请求及 JSON 数组，仅从 JSON 对象读取 team_key。
func workspaceInitializeTeamKey(c *gin.Context) string {
	r := c.Request
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		return ""
	}
	if r.Body == nil || r.Body == http.NoBody {
		return ""
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 2*1024*1024+1))
	shared.Must(err)
	if len(data) > 2*1024*1024 {
		shared.Fail(413, "请求内容超过大小限制")
	}
	if len(data) == 0 {
		return ""
	}
	if !utf8.Valid(data) {
		shared.Fail(400, "请求格式错误，请检查 JSON 和路径参数")
	}
	var value any
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.UseNumber()
	if decoder.Decode(&value) != nil {
		shared.Fail(400, "请求格式错误，请检查 JSON 和路径参数")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		shared.Fail(400, "请求格式错误，请检查 JSON 和路径参数")
	}
	switch parsed := value.(type) {
	case map[string]any:
		return workspaceOptionalKey(shared.Row(parsed), "team_key", "团队标识")
	case []any:
		return ""
	default:
		shared.Fail(400, "请求格式错误，请检查 JSON 和路径参数")
	}
	return ""
}

func (h *Handler) workspaceListProjects(c *gin.Context) {
	teamKey := ""
	if value, present := workspaceQueryValue(c, "team_key"); present {
		teamKey = shared.Key(value, "团队标识")
	}
	c.JSON(http.StatusOK, h.Service.ListProjects(c.Request.Context(), teamKey))
}

func (h *Handler) workspaceInitialize(c *gin.Context) {
	teamKey := workspaceInitializeTeamKey(c)
	c.JSON(http.StatusOK, h.Service.InitializeWorkspace(c.Request.Context(), teamKey))
}

func (h *Handler) workspaceCreateProject(c *gin.Context) {
	body := transport.Body(c)
	name := shared.Name(body["name"], "项目名称")
	teamKey := workspaceOptionalKey(body, "team_key", "团队标识")
	c.JSON(http.StatusOK, h.Service.CreateProject(c.Request.Context(), name, teamKey))
}

func (h *Handler) workspaceRenameProject(c *gin.Context) {
	key := shared.Key(c.Param("projectKey"), "项目标识")
	name := shared.Name(transport.Body(c)["name"], "项目名称")
	h.Service.RenameProject(c.Request.Context(), key, name)
	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) workspaceDeleteProject(c *gin.Context) {
	key := shared.Key(c.Param("projectKey"), "项目标识")
	h.Service.DeleteProject(c.Request.Context(), key, workspaceDeleteCascade(c))
	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) workspaceProjectTree(c *gin.Context) {
	key := shared.Key(c.Param("projectKey"), "项目标识")
	c.JSON(http.StatusOK, h.Service.ProjectTree(c.Request.Context(), key))
}

func (h *Handler) workspaceCreateFolder(c *gin.Context) {
	body := transport.Body(c)
	projectKey := shared.Key(body["project_key"], "项目标识")
	parentKey := ""
	if body["parent_key"] != nil {
		parentKey = shared.Key(body["parent_key"], "父文件夹标识")
	}
	name := shared.Name(body["name"], "文件夹名称")
	c.JSON(http.StatusOK, h.Service.CreateFolder(c.Request.Context(), projectKey, parentKey, name))
}

func (h *Handler) workspaceRenameFolder(c *gin.Context) {
	key := shared.Key(c.Param("folderKey"), "文件夹标识")
	name := shared.Name(transport.Body(c)["name"], "文件夹名称")
	h.Service.RenameFolder(c.Request.Context(), key, name)
	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) workspaceDeleteFolder(c *gin.Context) {
	key := shared.Key(c.Param("folderKey"), "文件夹标识")
	h.Service.DeleteFolder(c.Request.Context(), key, workspaceDeleteCascade(c))
	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) workspaceProjectPrivileges(c *gin.Context) {
	key := shared.Key(c.Param("projectKey"), "项目标识")
	c.JSON(http.StatusOK, h.Service.ProjectPrivileges(c.Request.Context(), key))
}

func (h *Handler) workspaceSetProjectPrivileges(c *gin.Context) {
	body := transport.Body(c)
	key := shared.Key(c.Param("projectKey"), "项目标识")
	c.JSON(http.StatusOK, h.Service.SetProjectPrivileges(c.Request.Context(), key, body["mode"], body["user_ids"]))
}

func (h *Handler) workspaceCreateDocument(c *gin.Context) {
	body := transport.Body(c)
	fileName := "untitled"
	if value, present := body["file_name"]; present {
		fileName = shared.Name(value, "文档名称")
	}
	projectKey := workspaceOptionalKey(body, "project_key", "项目标识")
	folderKey := workspaceOptionalKey(body, "folder_key", "文件夹标识")
	teamKey := workspaceOptionalKey(body, "team_key", "团队标识")
	input := service.CreateDocumentInput{FileName: fileName, ProjectKey: projectKey, FolderKey: folderKey, TeamKey: teamKey}
	c.JSON(http.StatusOK, h.Service.CreateDocument(c.Request.Context(), input))
}

func (h *Handler) workspaceGetDocument(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文档标识")
	c.JSON(http.StatusOK, h.Service.GetDocument(c.Request.Context(), key, c.Request.Method == http.MethodGet))
}

func (h *Handler) workspaceGetDocumentDetails(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文档标识")
	c.JSON(http.StatusOK, h.Service.GetDocumentDetails(c.Request.Context(), key))
}

// 普通 HTTP 更新仅负责重命名，正文统一由协同连接保存。
func (h *Handler) workspaceUpdateDocument(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文档标识")
	body := transport.Body(c)
	if _, present := body["file_content"]; present {
		shared.Fail(http.StatusBadRequest, "正文请通过协同连接保存")
	}
	value, present := body["file_name"]
	if !present {
		shared.Fail(http.StatusBadRequest, "请提供文档名称")
	}
	revision := h.Service.UpdateDocument(c.Request.Context(), key, shared.Name(value, "文档名称"))
	c.JSON(http.StatusOK, shared.Row{"success": true, "revision": revision})
}

func (h *Handler) workspaceDeleteDocument(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文档标识")
	h.Service.DeleteDocument(c.Request.Context(), key)
	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) workspaceListDocuments(c *gin.Context) {
	code := ""
	if value, present := workspaceQueryValue(c, "code"); present {
		var valid bool
		code, valid = value.(string)
		if !valid {
			shared.Fail(400, "搜索关键字必须是字符串")
		}
	}
	c.JSON(http.StatusOK, h.Service.ListDocuments(c.Request.Context(), code))
}
