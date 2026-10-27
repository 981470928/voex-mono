package handler

import (
	"strings"

	"github.com/gin-gonic/gin"

	"voex-server/internal/config"
)

// RegisterPublicRoutes exposes values that the Web client needs at runtime.
// The Pexels key is already shipped to browsers by design; keeping it in the
// server configuration lets prebuilt frontends run without a rebuild.
func (h *Handler) RegisterPublicRoutes(public *gin.RouterGroup) {
	public.GET("/public/config", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.JSON(200, gin.H{"pexelsKey": strings.TrimSpace(config.Env("PEXELS_API_KEY", ""))})
	})
}
