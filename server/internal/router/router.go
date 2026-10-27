// Package router assembles route groups and global Gin middleware.
package router

import (
	"log"
	"net/http"
	"strings"
	"voex-server/internal/handler"
	"voex-server/internal/middleware"
	"voex-server/internal/security"
	"voex-server/internal/service"
	"voex-server/internal/shared"
	"voex-server/internal/transport"

	"github.com/gin-gonic/gin"
)

type Router struct{ engine *gin.Engine }

func New(s *service.Service, logger *log.Logger) *Router {
	gin.SetMode(gin.ReleaseMode)
	engine := gin.New()
	engine.RedirectTrailingSlash = false
	engine.RedirectFixedPath = false
	engine.UseRawPath = true
	engine.UnescapePathValues = true
	shared.Must(engine.SetTrustedProxies([]string{"127.0.0.0/8", "::1/128"}))
	engine.Use(middleware.AccessLog(logger), middleware.Recovery(), middleware.RequestPolicy())
	h := handler.New(s, security.NewLimiter())
	public := engine.Group("/api")
	protected := public.Group("")
	protected.Use(middleware.Authentication(s, false))
	optional := public.Group("")
	optional.Use(middleware.Authentication(s, true))
	h.RegisterAuthRoutes(public, protected)
	h.RegisterHealthRoutes(public)
	h.RegisterAIRoutes(protected)
	h.RegisterTeamRoutes(public, protected)
	h.RegisterWorkspaceRoutes(protected)
	h.RegisterTrashRoutes(protected)
	h.RegisterRecentRoutes(protected)
	h.RegisterStorageRoutes(protected)
	h.RegisterShareRoutes(optional, protected)
	h.RegisterCollaborationRoutes(optional, engine)
	// 未匹配的 /api 路由：沿用先登录校验、再返回接口不存在的行为。
	engine.NoRoute(func(c *gin.Context) {
		if c.Request.URL.Path == "/api" || strings.HasPrefix(c.Request.URL.Path, "/api/") {
			s.Authenticate(c.Request.Context(), transport.AccessToken(c.Request), false)
			shared.Fail(404, "接口不存在")
		}
		c.String(404, "404 page not found")
	})
	return &Router{engine: engine}
}
func (r *Router) ServeHTTP(w http.ResponseWriter, request *http.Request) {
	// Preserve the existing API's acceptance of a trailing slash without redirecting writes.
	if len(request.URL.Path) > 1 && strings.HasSuffix(request.URL.Path, "/") {
		clone := request.Clone(request.Context())
		clone.URL.Path = strings.TrimRight(clone.URL.Path, "/")
		clone.URL.RawPath = strings.TrimRight(clone.URL.RawPath, "/")
		request = clone
	}
	r.engine.ServeHTTP(w, request)
}
