package handler

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
)

func (h *Handler) RegisterHealthRoutes(public *gin.RouterGroup) {
	public.GET("/health/live", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok"}) })
	public.GET("/health/ready", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()
		if err := h.Service.Readiness(ctx); err != nil {
			c.JSON(503, gin.H{"error": "服务尚未就绪"})
			return
		}
		c.JSON(200, gin.H{"status": "ok"})
	})
}
