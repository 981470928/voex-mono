// Package middleware contains Gin authentication, request policy and error boundaries.
package middleware

import (
	"github.com/gin-gonic/gin"
	driver "github.com/go-sql-driver/mysql"
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
			logger.Printf("%s %s %s %d %.3f ms", security.RemoteIP(c.Request), c.Request.Method, c.Request.URL.EscapedPath(), c.Writer.Status(), float64(time.Since(start).Microseconds())/1000)
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
				}
			}
		}()
		c.Next()
	}
}
func writeError(c *gin.Context, v any) {
	status, msg := 500, "服务器处理失败，请稍后重试"
	switch e := v.(type) {
	case shared.HTTPError:
		status, msg = e.Status, e.Message
	case *shared.HTTPError:
		status, msg = e.Status, e.Message
	case *http.MaxBytesError:
		status, msg = 413, "上传文件超过大小限制"
	case *driver.MySQLError:
		switch e.Number {
		case 1062:
			status, msg = 409, "资源标识冲突，请重试"
		case 1451, 1452:
			status, msg = 409, "资源关联已发生变化，请刷新后重试"
		case 1205, 1213:
			status, msg = 409, "工作区正在更新，请稍后重试"
		case 1406:
			status, msg = 400, "字段内容超过长度限制"
		}
	}
	if status == 500 {
		log.Printf("[API] request failed (%T)", v)
	}
	c.JSON(status, shared.Row{"error": msg})
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
			w.Header().Set("Access-Control-Allow-Headers", r.Header.Get("Access-Control-Request-Headers"))
			w.Header().Add("Vary", "Access-Control-Request-Headers")
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}
