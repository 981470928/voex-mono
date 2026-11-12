package handler

import (
	"github.com/gin-gonic/gin"
	"mime"
	"net/http"
	"voex-server/internal/shared"
	"voex-server/internal/transport"
)

func (h *Handler) RegisterDocumentTransferRoutes(protected *gin.RouterGroup) {
	protected.POST("/document/:fileKey/export", h.documentExport)
	protected.GET("/document-exports/:exportID", h.documentExportDownload)
	protected.DELETE("/document-exports/:exportID", h.documentExportRelease)
	protected.POST("/document/import", h.documentImport)
}

func (h *Handler) documentExport(c *gin.Context) {
	body := transport.BodyRequestLimit(c.Request, 4096)
	format, ok := body["format"].(string)
	if !ok || (format != "voex" && format != "markdown") {
		shared.Fail(http.StatusBadRequest, shared.MsgExportFormatRequired)
	}
	preserve := false
	if value, present := body["preserve_styles"]; present {
		var valid bool
		preserve, valid = value.(bool)
		if !valid {
			shared.Fail(http.StatusBadRequest, shared.MustBeMessage("样式选项", shared.MsgBooleanType))
		}
	}
	c.JSON(
		http.StatusOK,
		h.Service.ExportDocument(
			c.Request.Context(),
			shared.Key(c.Param("fileKey"), "文档标识"),
			format,
			preserve,
		),
	)
}

func (h *Handler) documentExportDownload(c *gin.Context) {
	file, name := h.Service.OpenDocumentExport(
		c.Request.Context(),
		shared.Key(c.Param("exportID"), "导出标识"),
	)
	defer file.Close()
	info, err := file.Stat()
	shared.Must(err)
	c.Header("Content-Type", "application/zip")
	c.Header(
		"Content-Disposition",
		mime.FormatMediaType("attachment", map[string]string{"filename": name}),
	)
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	http.ServeContent(c.Writer, c.Request, name, info.ModTime(), file)
}

func (h *Handler) documentImport(c *gin.Context) {
	c.JSON(http.StatusOK, h.Service.ImportDocumentRequest(c.Writer, c.Request))
}

func (h *Handler) documentExportRelease(c *gin.Context) {
	h.Service.ReleaseDocumentExport(c.Request.Context(), shared.Key(c.Param("exportID"), "导出标识"))
	c.JSON(http.StatusOK, shared.Row{"success": true})
}
