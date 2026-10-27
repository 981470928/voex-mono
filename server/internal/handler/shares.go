package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"time"
	"voex-server/internal/shared"
	"voex-server/internal/transport"
)

func (h *Handler) RegisterShareRoutes(optional, protected *gin.RouterGroup) {
	protected.GET("/document/:fileKey/sharing", h.shareSettings)
	protected.PATCH("/document/:fileKey/sharing", h.shareSettingsUpdate)
	protected.DELETE("/document/:fileKey/access/:userId", h.shareAccessRevoke)

	public := optional.Group("/shared-file", h.shareAccess)
	// GET /api/shared-file：持有效分享令牌的匿名或登录用户读取指定文档。
	public.GET("", h.shareGetDocument)
	// HEAD /api/shared-file：校验有效分享令牌后返回文档响应头。
	public.HEAD("", h.shareGetDocument)
	// GET /api/shared-file/attachments/:hash：持有效分享令牌的用户读取该文档附件。
	public.GET("/attachments/:hash", h.shareGetAttachment)
	// HEAD /api/shared-file/attachments/:hash：校验分享令牌后读取附件响应头。
	public.HEAD("/attachments/:hash", h.shareGetAttachment)
	// GET /api/shared-file/creator-avator：持有效分享令牌的用户读取该文档创建者头像。
	public.GET("/creator-avator", h.shareGetAvatar)
	// HEAD /api/shared-file/creator-avator：校验分享令牌后读取创建者头像响应头。
	public.HEAD("/creator-avator", h.shareGetAvatar)
}

func (h *Handler) shareAccess(c *gin.Context) {
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Cache-Control", "no-store")
	h.Limiter.Limit(c.Request, "shared-file", 180, time.Minute)
	c.Next()
}
func (h *Handler) shareSettings(c *gin.Context) {
	c.JSON(200, h.Service.DocumentSharing(c.Request.Context(), c.Param("fileKey")))
}
func (h *Handler) shareSettingsUpdate(c *gin.Context) {
	h.Service.SetDocumentSharing(c.Request.Context(), c.Param("fileKey"), transport.Body(c))
	c.JSON(200, shared.Row{"success": true})
}
func (h *Handler) shareAccessRevoke(c *gin.Context) {
	h.Service.RevokeDocumentAccess(c.Request.Context(), c.Param("fileKey"), c.Param("userId"))
	c.JSON(200, shared.Row{"success": true})
}
func (h *Handler) shareGetDocument(c *gin.Context) {
	c.JSON(200, h.Service.GetSharedDocument(c.Request.Context(), c.GetHeader("X-Share-Token"), c.Request.Method == http.MethodGet))
}
func (h *Handler) shareGetAttachment(c *gin.Context) {
	file := h.Service.SharedAttachment(c.Request.Context(), c.GetHeader("X-Share-Token"), c.Param("hash"))
	h.Service.Files.Serve(c.Writer, c.Request, file)
}
func (h *Handler) shareGetAvatar(c *gin.Context) {
	file := h.Service.SharedAvatar(c.Request.Context(), c.GetHeader("X-Share-Token"))
	h.Service.Files.Serve(c.Writer, c.Request, file)
}
