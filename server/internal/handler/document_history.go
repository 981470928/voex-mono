package handler

import (
	"net/http"
	"strconv"
	"voex-server/internal/shared"
	"voex-server/internal/transport"

	"github.com/gin-gonic/gin"
)

// RegisterDocumentHistoryRoutes 注册文档历史版本接口；全部需要登录。
func (h *Handler) RegisterDocumentHistoryRoutes(protected *gin.RouterGroup) {
	group := protected.Group("/document/:fileKey/versions")
	// GET/HEAD：列出版本元数据（不含正文）；limit 必填，before 为游标版本 id。
	group.Match([]string{http.MethodGet, http.MethodHead}, "", h.historyList)
	// GET/HEAD：读取单个版本全文。
	group.Match([]string{http.MethodGet, http.MethodHead}, "/:versionId", h.historyGet)
	// POST：把当前正文保存为命名版本；需要文档写权限。
	group.POST("", h.historyCreate)
	// DELETE：删除命名版本；其他类型不可删。
	group.DELETE("/:versionId", h.historyRemove)
	// POST：恢复到指定版本，恢复前自动保护当前内容；需要文档写权限。
	group.POST("/:versionId/restore", h.historyRestore)
}

func historyVersionID(c *gin.Context) int64 {
	id, err := strconv.ParseInt(c.Param("versionId"), 10, 64)
	if err != nil || id <= 0 {
		shared.Fail(
			http.StatusBadRequest,
			shared.MustBeMessage("versionId", shared.MsgPositiveInteger),
		)
	}
	return id
}

func (h *Handler) historyList(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文档标识")
	value, present := workspaceQueryValue(c, "limit")
	text, valid := value.(string)
	limit, err := strconv.ParseInt(text, 10, 64)
	if !present || !valid || err != nil || limit <= 0 {
		shared.Fail(http.StatusBadRequest, shared.MustBeMessage("limit", shared.MsgPositiveInteger))
	}
	var before int64
	if raw, present := workspaceQueryValue(c, "before"); present {
		text, valid := raw.(string)
		cursor, err := strconv.ParseInt(text, 10, 64)
		if !valid || err != nil || cursor <= 0 {
			shared.Fail(
				http.StatusBadRequest,
				shared.MustBeMessage("before", shared.MsgPositiveInteger),
			)
		}
		before = cursor
	}
	c.JSON(http.StatusOK, h.Service.ListDocumentVersions(c.Request.Context(), key, limit, before))
}

func (h *Handler) historyGet(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文档标识")
	c.JSON(
		http.StatusOK,
		h.Service.GetDocumentVersion(c.Request.Context(), key, historyVersionID(c)),
	)
}

func (h *Handler) historyCreate(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文档标识")
	body := transport.Body(c)
	label := ""
	if value, present := body["label"]; present && value != nil {
		text, ok := value.(string)
		if !ok {
			shared.Fail(http.StatusBadRequest, shared.MustBeMessage("版本标签", shared.MsgStringType))
		}
		label = shared.Characters(text, "版本标签", 0, 255)
	}
	c.JSON(http.StatusOK, h.Service.CreateDocumentVersion(c.Request.Context(), key, label))
}

func (h *Handler) historyRemove(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文档标识")
	h.Service.DeleteDocumentVersion(c.Request.Context(), key, historyVersionID(c))
	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) historyRestore(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文档标识")
	c.JSON(
		http.StatusOK,
		h.Service.RestoreDocumentVersion(c.Request.Context(), key, historyVersionID(c)),
	)
}
