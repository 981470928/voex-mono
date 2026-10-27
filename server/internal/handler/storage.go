package handler

import (
	"github.com/gin-gonic/gin"
	"voex-server/internal/shared"
)

func (h *Handler) RegisterStorageRoutes(protected *gin.RouterGroup) {
	// POST /api/assets/upload：登录用户上传资产，头像和缩略图转换为 WebP。
	protected.POST("/assets/upload", h.storageUploadAsset)
	// GET /api/assets/:id：创建者或同团队成员读取允许访问的头像资产。
	protected.GET("/assets/:id", h.storageGetAsset)
	// HEAD /api/assets/:id：通过相同权限校验后返回资产响应头。
	protected.HEAD("/assets/:id", h.storageGetAsset)
	// POST /api/upload：有文档写权限的登录用户上传附件。
	protected.POST("/upload", h.storageUploadAttachment)
	// GET /api/files/:fileKey：有文档读权限的登录用户列出附件。
	protected.GET("/files/:fileKey", h.storageListAttachments)
	// HEAD /api/files/:fileKey：校验文档读权限并返回附件列表响应头。
	protected.HEAD("/files/:fileKey", h.storageListAttachments)
	// GET /api/download/:fileKey/:hash：有文档读权限的用户下载附件，支持 Range。
	protected.GET("/download/:fileKey/:hash", h.storageDownloadAttachment)
	// HEAD /api/download/:fileKey/:hash：有文档读权限的用户读取附件响应头。
	protected.HEAD("/download/:fileKey/:hash", h.storageDownloadAttachment)
	// GET /api/upload-progress/:fileKey/:hash：有文档读权限的用户查询上传完成状态。
	protected.GET("/upload-progress/:fileKey/:hash", h.storageAttachmentProgress)
	// HEAD /api/upload-progress/:fileKey/:hash：校验文档读权限并返回进度响应头。
	protected.HEAD("/upload-progress/:fileKey/:hash", h.storageAttachmentProgress)
	// DELETE /api/attachment/:fileKey/:hash：有文档写权限的用户删除附件记录。
	protected.DELETE("/attachment/:fileKey/:hash", h.storageDeleteAttachment)
}

func (h *Handler) storageUploadAsset(c *gin.Context) {
	upload := h.Service.Files.ReadUpload(c.Writer, c.Request, true)
	c.JSON(201, h.Service.UploadAsset(c.Request.Context(), upload))
}
func (h *Handler) storageGetAsset(c *gin.Context) {
	file := h.Service.AssetDownload(c.Request.Context(), c.Param("id"))
	h.Service.Files.Serve(c.Writer, c.Request, file)
}
func (h *Handler) storageUploadAttachment(c *gin.Context) {
	upload := h.Service.Files.ReadUpload(c.Writer, c.Request, false)
	c.JSON(200, h.Service.UploadAttachment(c.Request.Context(), upload))
}
func (h *Handler) storageListAttachments(c *gin.Context) {
	c.JSON(200, h.Service.ListAttachments(c.Request.Context(), c.Param("fileKey")))
}
func (h *Handler) storageDownloadAttachment(c *gin.Context) {
	file := h.Service.AttachmentDownload(c.Request.Context(), c.Param("fileKey"), c.Param("hash"))
	h.Service.Files.Serve(c.Writer, c.Request, file)
}
func (h *Handler) storageAttachmentProgress(c *gin.Context) {
	c.JSON(200, h.Service.AttachmentProgress(c.Request.Context(), c.Param("fileKey"), c.Param("hash")))
}
func (h *Handler) storageDeleteAttachment(c *gin.Context) {
	h.Service.DeleteAttachment(c.Request.Context(), c.Param("fileKey"), c.Param("hash"))
	c.JSON(200, shared.Row{"success": true})
}
