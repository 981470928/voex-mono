package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"voex-server/internal/service"
	"voex-server/internal/shared"
	"voex-server/internal/transport"

	"github.com/gin-gonic/gin"
)

func (h *Handler) RegisterAIRoutes(protected *gin.RouterGroup) {
	h.registerAIWebRoutes(protected)
	// 模型配置仅当前登录账号可读写；读取永不返回 API Key。
	protected.GET(
		"/ai/models",
		func(c *gin.Context) { c.JSON(http.StatusOK, h.Service.ListAIModels(c.Request.Context())) },
	)
	protected.PUT("/ai/models/:id", func(c *gin.Context) {
		id := shared.Key(c.Param("id"), "配置标识")
		c.JSON(http.StatusOK, h.Service.SaveAIModel(c.Request.Context(), id, transport.Body(c)))
	})
	protected.DELETE("/ai/models/:id", func(c *gin.Context) {
		h.Service.DeleteAIModel(c.Request.Context(), shared.Key(c.Param("id"), "配置标识"))
		c.JSON(http.StatusOK, shared.Row{"success": true})
	})
	protected.POST("/ai/models/:id/attachments", func(c *gin.Context) {
		id := shared.Key(c.Param("id"), "配置标识")
		c.Request.Body = http.MaxBytesReader(
			c.Writer,
			c.Request.Body,
			service.AIAttachmentMaxSize+64*1024,
		)
		c.JSON(http.StatusOK, h.Service.ParseAIAttachment(c.Request.Context(), id, c.Request))
	})
	// 固定转发到账号已保存的模型，客户端不能传入密钥或覆盖目标地址。
	protected.POST("/ai/models/:id/chat", func(c *gin.Context) {
		id := shared.Key(c.Param("id"), "配置标识")
		body := transport.Body(c)
		if acceptsAIStream(c.GetHeader("Accept")) {
			h.streamAIChat(c, id, body)
			return
		}
		result := h.Service.AIChat(c.Request.Context(), id, body)
		c.Data(http.StatusOK, "application/json; charset=utf-8", result)
	})
	// 只有用户应用审阅时调用；所有文件在同一事务内检查权限、版本并保存。
	protected.POST("/ai/reviews/:id/apply", func(c *gin.Context) {
		defer func() {
			if failure := recover(); failure != nil {
				if conflict, ok := failure.(service.AIReviewConflictError); ok {
					c.AbortWithStatusJSON(
						http.StatusConflict,
						shared.Row{"error": conflict.Error(), "code": shared.CodeAIReviewConflict},
					)
					return
				}
				panic(failure)
			}
		}()
		id := shared.Key(c.Param("id"), "审阅标识")
		body := transport.Body(c)
		force := false
		for field, value := range body {
			if field != "force" {
				shared.Fail(http.StatusBadRequest, shared.MsgAIReviewForceOnly)
			}
			var ok bool
			force, ok = value.(bool)
			if !ok {
				shared.Fail(
					http.StatusBadRequest,
					shared.MustBeMessage("force", shared.MsgBooleanType),
				)
			}
		}
		c.JSON(http.StatusOK, h.Service.ApplyAIReview(c.Request.Context(), id, force))
	})
	protected.GET("/ai/reviews/:id", func(c *gin.Context) {
		c.JSON(
			http.StatusOK,
			h.Service.GetAIReview(c.Request.Context(), shared.Key(c.Param("id"), "审阅标识")),
		)
	})
	protected.GET("/ai/conversations/:fileKey/sessions", func(c *gin.Context) {
		c.JSON(
			http.StatusOK,
			h.Service.ListAISessions(
				c.Request.Context(),
				shared.Key(c.Param("fileKey"), "文件标识"),
				aiHistoryCursor(c),
			),
		)
	})
	protected.PUT("/ai/conversations/:fileKey/sessions/:id", func(c *gin.Context) {
		if c.Request.ContentLength != 0 && len(transport.Body(c)) != 0 {
			shared.Fail(http.StatusBadRequest, shared.MsgAISessionExtraFields)
		}
		c.JSON(
			http.StatusOK,
			h.Service.CreateAISession(
				c.Request.Context(),
				shared.Key(c.Param("fileKey"), "文件标识"),
				shared.Key(c.Param("id"), "会话标识"),
			),
		)
	})
	protected.DELETE("/ai/conversations/:fileKey/sessions/:id", func(c *gin.Context) {
		h.Service.DeleteAISession(
			c.Request.Context(),
			shared.Key(c.Param("fileKey"), "文件标识"),
			shared.Key(c.Param("id"), "会话标识"),
		)
		c.JSON(http.StatusOK, shared.Row{"success": true})
	})
	protected.GET("/ai/conversations/:fileKey", func(c *gin.Context) {
		c.JSON(
			http.StatusOK,
			h.Service.AIConversation(
				c.Request.Context(),
				shared.Key(c.Param("fileKey"), "文件标识"),
				c.Query("session_id"),
				aiHistoryCursor(c),
			),
		)
	})
	protected.PUT("/ai/conversations/:fileKey/turns/:id", func(c *gin.Context) {
		body := transport.BodyRequestLimit(c.Request, 32*1024*1024)
		prompt, ok := body["prompt"].(string)
		if !ok {
			shared.Fail(http.StatusBadRequest, shared.MsgAIPromptRequired)
		}
		session := ""
		if value, ok := body["session_id"]; ok {
			session = shared.Key(value, "会话标识")
		}
		c.JSON(
			http.StatusOK,
			h.Service.BeginAITurn(
				c.Request.Context(),
				shared.Key(c.Param("fileKey"), "文件标识"),
				shared.Key(c.Param("id"), "对话标识"),
				session,
				shared.Key(body["model_id"], "模型配置标识"),
				prompt,
				service.ReadAIAttachments(body["attachments"]),
			),
		)
	})
	protected.PUT("/ai/conversations/:fileKey/turns/:id/response", func(c *gin.Context) {
		data, err := json.Marshal(transport.Body(c))
		shared.Must(err)
		var input service.AIFinishTurnInput
		if json.Unmarshal(data, &input) != nil {
			shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("回复或审阅快照"))
		}
		c.JSON(
			http.StatusOK,
			h.Service.FinishAITurn(
				c.Request.Context(),
				shared.Key(c.Param("fileKey"), "文件标识"),
				shared.Key(c.Param("id"), "对话标识"),
				input,
			),
		)
	})
}

func aiHistoryCursor(c *gin.Context) uint64 {
	if raw := c.Query("before"); raw != "" {
		before, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || before == 0 {
			shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("历史游标"))
		}
		return before
	}
	return 0
}
