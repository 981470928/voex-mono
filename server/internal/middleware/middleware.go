// Package middleware contains Gin authentication, request policy and error boundaries.
// middleware 包包含 Gin 身份认证、请求策略和错误边界。
package middleware

import (
	"github.com/gin-gonic/gin"
	"log"
	"net/http"
	"strings"
	"time"
	"voex-server/internal/security"
	"voex-server/internal/service"
	"voex-server/internal/shared"
	"voex-server/internal/transport"
)

func AccessLog(logger *log.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		defer func() {
			logger.Printf(
				"%s %s %s %d %.3f ms",
				security.RemoteIP(c.Request),
				c.Request.Method,
				c.Request.URL.EscapedPath(),
				c.Writer.Status(),
				float64(time.Since(start).Microseconds())/1000,
			)
		}()
		c.Next()
	}
}
func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				c.Abort()
				if !c.Writer.Written() {
					writeError(c, v)
				} else {
					shared.LogFailure("response already started", v)
				}
			}
		}()
		c.Next()
	}
}
func writeError(c *gin.Context, v any) {
	failure := shared.PublicError(v)
	c.JSON(failure.Status, shared.Row{"error": failure.Message})
}
func Authentication(s *service.Service, optional bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := s.Authenticate(c.Request.Context(), transport.AccessToken(c.Request), optional)
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}
func RequestPolicy() gin.HandlerFunc {
	return func(c *gin.Context) {
		r := c.Request
		w := c.Writer
		if strings.HasPrefix(r.URL.Path, "/api") {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
		}
		origin := r.Header.Get("Origin")
		w.Header().Add("Vary", "Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE")
			w.Header().
				Set("Access-Control-Allow-Headers", r.Header.Get("Access-Control-Request-Headers"))
			w.Header().Add("Vary", "Access-Control-Request-Headers")
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
