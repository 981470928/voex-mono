package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"
	"voex-server/internal/shared"

	"github.com/gin-gonic/gin"
	driver "github.com/go-sql-driver/mysql"
)

// Streaming is opt-in so existing clients keep the original JSON response.
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

// Match the existing recovery boundary without exposing upstream errors or panic values.
func aiStreamFailure(failure any) aiStreamResult {
	result := aiStreamResult{status: http.StatusInternalServerError, error: "服务器处理失败，请稍后重试"}
	switch err := failure.(type) {
	case shared.HTTPError:
		result.status, result.error = err.Status, err.Message
	case *shared.HTTPError:
		if err != nil {
			result.status, result.error = err.Status, err.Message
		}
	case *http.MaxBytesError:
		result.status, result.error = http.StatusRequestEntityTooLarge, "上传文件超过大小限制"
	case *driver.MySQLError:
		if err != nil {
			switch err.Number {
			case 1062:
				result.status, result.error = http.StatusConflict, "资源标识冲突，请重试"
			case 1451, 1452:
				result.status, result.error = http.StatusConflict, "资源关联已发生变化，请刷新后重试"
			case 1205, 1213:
				result.status, result.error = http.StatusConflict, "工作区正在更新，请稍后重试"
			case 1406:
				result.status, result.error = http.StatusBadRequest, "字段内容超过长度限制"
			}
		}
	}
	if result.status == http.StatusInternalServerError {
		log.Printf("[API] AI stream request failed (%T)", failure)
	}
	return result
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
