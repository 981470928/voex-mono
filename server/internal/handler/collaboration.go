package handler

import (
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"time"
	"voex-server/internal/service"
	"voex-server/internal/shared"
	"voex-server/internal/transport"
)

func (h *Handler) RegisterCollaborationRoutes(optional *gin.RouterGroup, engine *gin.Engine) {
	optional.POST("/collab/ticket", func(c *gin.Context) {
		h.Limiter.Limit(c.Request, "collaboration-ticket", 120, time.Minute)
		body := transport.Body(c)
		c.Header("Cache-Control", "no-store")
		c.JSON(200, h.Service.CollaborationTicket(c.Request.Context(), shared.String(body["file_key"]), shared.String(body["access"]), c.GetHeader("X-Share-Token"), transport.AccessToken(c.Request)))
	})
	internal := engine.Group("/internal/collab", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if !h.Service.CollaborationInternal(c.GetHeader("X-Collab-Secret")) {
			c.AbortWithStatus(403)
			return
		}
		c.Next()
	})
	decode := func(c *gin.Context) service.CollaborationRequest {
		var input service.CollaborationRequest
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 26<<20)
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		check := func(err error) {
			if err != nil {
				var large *http.MaxBytesError
				if errors.As(err, &large) {
					shared.Fail(413, "协同请求超过大小限制")
				}
				shared.Fail(400, "协同请求格式无效")
			}
		}
		check(decoder.Decode(&input))
		var trailing any
		if err := decoder.Decode(&trailing); err != io.EOF {
			if err == nil {
				shared.Fail(400, "协同请求仅允许一个JSON对象")
			}
			check(err)
		}
		input.FileKey = shared.Key(input.FileKey, "文件标识")
		return input
	}
	internal.POST("/authorize", func(c *gin.Context) {
		in := decode(c)
		c.JSON(200, h.Service.AuthorizeCollaboration(c.Request.Context(), in.Ticket, in.AuthorizationID, in.FileKey))
	})
	internal.POST("/load", func(c *gin.Context) { c.JSON(200, h.Service.LoadCollaboration(c.Request.Context(), decode(c))) })
	internal.POST("/initialize", func(c *gin.Context) { c.JSON(200, h.Service.InitializeCollaboration(c.Request.Context(), decode(c))) })
	internal.POST("/commit", func(c *gin.Context) { c.JSON(200, h.Service.CommitCollaboration(c.Request.Context(), decode(c))) })
}
