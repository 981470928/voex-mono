package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
	"voex-server/internal/identity"
	"voex-server/internal/shared"
)

func (h *Handler) RegisterRecentRoutes(protected *gin.RouterGroup) {
	group := protected.Group("/recent-files")
	// GET/HEAD：按前端传入的 limit 返回本人最近记录；GET 响应写出后按同一 limit 清理。
	group.Match([]string{http.MethodGet, http.MethodHead}, "", h.recentList)
	// GET/HEAD：凭本人的访问记录及仍有效的文件授权读取正文。
	group.Match([]string{http.MethodGet, http.MethodHead}, "/:fileKey", h.recentGet)
	// GET/HEAD：重新检查当前授权，仅返回文件详情，不记录访问。
	group.Match([]string{http.MethodGet, http.MethodHead}, "/:fileKey/details", h.recentDetails)
	// DELETE：仅删除本人的查看记录，不修改文档、附件或分享。
	group.DELETE("/:fileKey", h.recentRemove)
	// GET/HEAD：独立校验当前文件权限后下载其附件。
	group.Match([]string{http.MethodGet, http.MethodHead}, "/:fileKey/attachments/:hash", h.recentAttachment)
}

func (h *Handler) recentList(c *gin.Context) {
	value, present := workspaceQueryValue(c, "limit")
	text, valid := value.(string)
	limit, err := strconv.Atoi(text)
	if !present || !valid || err != nil || limit <= 0 {
		shared.Fail(http.StatusBadRequest, "limit 必须是正整数")
	}
	ctx := c.Request.Context()
	userID := shared.String(identity.User(ctx)["id"])
	result, needsCleanup := h.Service.ListRecentFiles(ctx, limit)
	c.JSON(http.StatusOK, result)
	if needsCleanup && c.Request.Method == http.MethodGet && !c.IsAborted() {
		c.Writer.Flush()
		h.Service.ScheduleRecentCleanup(userID, limit)
	}
}

func (h *Handler) recentGet(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文件标识")
	c.JSON(http.StatusOK, h.Service.GetRecentFile(c.Request.Context(), key, c.Request.Method == http.MethodGet))
}

func (h *Handler) recentDetails(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文件标识")
	c.JSON(http.StatusOK, h.Service.GetRecentFileDetails(c.Request.Context(), key))
}

func (h *Handler) recentRemove(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文件标识")
	h.Service.RemoveRecentFile(c.Request.Context(), key)
	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) recentAttachment(c *gin.Context) {
	key := shared.Key(c.Param("fileKey"), "文件标识")
	file := h.Service.RecentAttachment(c.Request.Context(), key, c.Param("hash"))
	h.Service.Files.Serve(c.Writer, c.Request, file)
}
