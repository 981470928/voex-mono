package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"
	"voex-server/internal/shared"

	"github.com/gin-gonic/gin"
)

// Streaming is opt-in so existing clients keep the original JSON response.
// 流式响应需要显式启用，现有客户端仍使用原来的 JSON 响应。
func acceptsAIStream(accept string) bool {
	for _, part := range strings.Split(accept, ",") {
		media, parameters, err := mime.ParseMediaType(strings.TrimSpace(part))
		if err != nil || media != "text/event-stream" {
			continue
		}
		if raw, ok := parameters["q"]; ok {
			quality, err := strconv.ParseFloat(raw, 64)
			if err != nil || quality <= 0 || quality > 1 {
				continue
			}
		}
		return true
	}
	return false
}

type aiStreamResult struct {
	data   []byte
	status int
	error  string
}

// Both transports use the same classification and public messages.
// 两种传输方式使用相同的错误分类和对外消息。
func aiStreamFailure(failure any) aiStreamResult {
	result := shared.PublicError(failure)
	return aiStreamResult{status: result.Status, error: result.Message}
}

func (h *Handler) streamAIChat(c *gin.Context, id string, body shared.Row) {
	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	controller := http.NewResponseController(c.Writer)
	write := func(frame string) bool {
		if ctx.Err() != nil {
			return false
		}
		if _, err := io.WriteString(c.Writer, frame); err != nil {
			return false
		}
		return controller.Flush() == nil
	}
	// Flush headers immediately, before waiting for a model response.
	// 等待模型响应前，立即刷新并发送响应头。
	if !write(": connected\n\n") {
		return
	}
	completed := make(chan aiStreamResult, 1)
	go func() {
		result := aiStreamResult{}
		defer func() {
			if failure := recover(); failure != nil {
				result = aiStreamFailure(failure)
			}
			select {
			case completed <- result:
			case <-ctx.Done():
			}
		}()
		data := h.Service.AIChat(ctx, id, body)
		// One SSE data line must not contain raw JSON formatting newlines.
		// 单条 SSE data 行不得含有 JSON 格式化产生的原始换行符。
		var compact bytes.Buffer
		shared.Must(json.Compact(&compact, data))
		result.data = compact.Bytes()
	}()
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !write(": heartbeat\n\n") {
				return
			}
		case result := <-completed:
			if ctx.Err() != nil {
				return
			}
			if result.error != "" {
				data, _ := json.Marshal(shared.Row{"error": result.error, "status": result.status})
				write("event: error\ndata: " + string(data) + "\n\n")
				return
			}
			write("event: result\ndata: " + string(result.data) + "\n\n")
			return
		}
	}
}
