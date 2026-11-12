package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"voex-server/internal/config"
)

// RegisterPublicRoutes exposes values that the Web client needs at runtime.
// The Pexels key is already shipped to browsers by design; keeping it in the
// server configuration lets prebuilt frontends run without a rebuild.
// RegisterPublicRoutes 提供 Web 客户端运行时需要的配置值。
// 按现有设计，Pexels key 本就会发送到浏览器；将其保存在服务器配置中，
// 可让预构建前端无需重新构建即可运行。
func (h *Handler) RegisterPublicRoutes(public *gin.RouterGroup) {
	public.GET("/public/config", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.JSON(
			http.StatusOK,
			gin.H{"pexelsKey": strings.TrimSpace(config.Env("PEXELS_API_KEY", ""))},
		)
	})
}
