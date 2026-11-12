package handler

import (
	"net/http"
	"time"
	"voex-server/internal/identity"
	"voex-server/internal/shared"
	"voex-server/internal/transport"

	"github.com/gin-gonic/gin"
)

func (h *Handler) storageFetchImage(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	h.Limiter.LimitKey(
		"image-fetch:"+shared.String(identity.User(c.Request.Context())["id"]),
		30,
		time.Minute,
	)
	data, contentType := h.Service.FetchDocumentImage(
		c.Request.Context(),
		transport.BodyRequestLimit(c.Request, 8192),
	)
	c.Data(http.StatusOK, contentType, data)
}
