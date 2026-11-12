package handler

import (
	"net/http"
	"time"
	"voex-server/internal/identity"
	"voex-server/internal/shared"
	"voex-server/internal/transport"

	"github.com/gin-gonic/gin"
)

func (h *Handler) registerAIWebRoutes(protected *gin.RouterGroup) {
	protected.GET("/ai/web/engines", func(c *gin.Context) {
		c.JSON(http.StatusOK, shared.Row{"engines": h.Service.AIWebEngines()})
	})
	limit := func(c *gin.Context) {
		// Counting both tools bounds public fetches and paid searches per account.
		// 同时统计两种工具的调用次数，以限制每个账号的公开抓取和付费搜索次数。
		h.Limiter.LimitKey(
			"ai-web:"+shared.String(identity.User(c.Request.Context())["id"]),
			30,
			time.Minute,
		)
	}
	protected.POST("/ai/web/search", func(c *gin.Context) {
		limit(c)
		c.JSON(
			http.StatusOK,
			h.Service.AIWebSearch(c.Request.Context(), transport.BodyRequestLimit(c.Request, 8192)),
		)
	})
	protected.POST("/ai/web/fetch", func(c *gin.Context) {
		limit(c)
		c.JSON(
			http.StatusOK,
			h.Service.AIWebFetch(c.Request.Context(), transport.BodyRequestLimit(c.Request, 8192)),
		)
	})
}
