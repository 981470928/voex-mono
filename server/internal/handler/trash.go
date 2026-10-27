package handler

import (
	"net/http"
	"strconv"
	"voex-server/internal/shared"

	"github.com/gin-gonic/gin"
)

func (h *Handler) RegisterTrashRoutes(protected *gin.RouterGroup) {
	group := protected.Group("/trash")
	group.POST("/restore-all", h.trashRestoreAll)
	group.DELETE("", h.trashClear)

	// POST /api/trash/:type/:key/restore：恢复文档或文件夹，需要登录及项目写权限。
	group.POST("/:type/:key/restore", h.trashRestore)
	// DELETE /api/trash/:type/:key：彻底删除回收站中的对象，需要登录及项目写权限。
	group.DELETE("/:type/:key", h.trashPurge)
	// GET/HEAD /ap	i/trash：查询当前用户有项目写权限的回收站内容，需要登录。
	group.Match([]string{http.MethodGet, http.MethodHead}, "", h.trashList)
}

func (h *Handler) trashRestore(c *gin.Context) {
	key := shared.Key(c.Param("key"), "资源标识")
	ctx := c.Request.Context()

	switch c.Param("type") {
	case "document":
		h.Service.RestoreDocument(ctx, key)
	case "folder":
		h.Service.RestoreFolder(ctx, key)
	default:
		shared.Fail(http.StatusBadRequest, "type 只能是 document 或 folder")
	}

	c.JSON(http.StatusOK, shared.Row{"success": true})
}

// trashQueryInt 读取单个整数参数，未提供时使用默认值。
func trashQueryInt(c *gin.Context, field string, defaultValue int) int {
	value, present := workspaceQueryValue(c, field)
	if !present {
		return defaultValue
	}

	text, valid := value.(string)
	number, err := strconv.Atoi(text)
	if !valid || err != nil {
		shared.Fail(http.StatusBadRequest, field+" 必须是单个整数")
	}

	return number
}

func (h *Handler) trashList(c *gin.Context) {
	teamKey, projectKey := "", ""

	if value, present := workspaceQueryValue(c, "team_key"); present {
		teamKey = shared.Key(value, "团队标识")
	}
	if value, present := workspaceQueryValue(c, "project_key"); present {
		projectKey = shared.Key(value, "项目标识")
	}

	limit := trashQueryInt(c, "limit", 50)
	offset := trashQueryInt(c, "offset", 0)

	result := h.Service.ListTrash(
		c.Request.Context(),
		teamKey,
		projectKey,
		limit,
		offset,
	)

	c.JSON(http.StatusOK, result)
}
func (h *Handler) trashPurge(c *gin.Context) {
	key := shared.Key(c.Param("key"), "资源标识")
	ctx := c.Request.Context()

	switch c.Param("type") {
	case "document":
		h.Service.PurgeDocument(ctx, key)
	case "folder":
		h.Service.PurgeFolder(ctx, key)
	default:
		shared.Fail(http.StatusBadRequest, "type 只能是 document 或 folder")
	}

	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) trashRestoreAll(c *gin.Context) {
	h.Service.BulkTrash(c.Request.Context(), c.Query("team_key"), c.Query("project_key"), true)
	c.JSON(200, shared.Row{"success": true})
}
func (h *Handler) trashClear(c *gin.Context) {
	h.Service.BulkTrash(c.Request.Context(), c.Query("team_key"), c.Query("project_key"), false)
	c.JSON(200, shared.Row{"success": true})
}
