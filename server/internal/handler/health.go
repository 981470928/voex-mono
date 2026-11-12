package handler

import (
	"context"
	"net/http"
	"time"
	"voex-server/internal/shared"

	"github.com/gin-gonic/gin"
)

func (h *Handler) RegisterHealthRoutes(public *gin.RouterGroup) {
	public.GET(
		"/health/live",
		func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) },
	)
	public.GET("/health/ready", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()
		if err := h.Service.Readiness(ctx); err != nil {
			shared.LogFailure("readiness", err)
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": shared.MsgServiceUnavailable})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
}
