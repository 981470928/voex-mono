package handler

import (
	"github.com/gin-gonic/gin"
	"time"
	"voex-server/internal/identity"
	"voex-server/internal/security"
	"voex-server/internal/service"
	"voex-server/internal/shared"
	"voex-server/internal/transport"
)

func (h *Handler) RegisterAuthRoutes(public, protected *gin.RouterGroup) {
	// POST /api/auth/account-availability：检查账号是否可用，公开且限流。
	public.POST("/auth/account-availability", h.accountAvailability)
	// POST /api/auth/register：注册账号、个人团队和登录会话，公开且限流。
	public.POST("/auth/register", h.register)
	// POST /api/auth/login：校验密码并创建登录会话，公开且限制失败次数。
	public.POST("/auth/login", h.login)
	// POST /api/auth/refresh：使用刷新 Cookie 续签访问令牌，无需有效访问令牌。
	public.POST("/auth/refresh", h.refresh)
	// POST /api/auth/logout：撤销当前会话并清理 Cookie，可重复调用。
	public.POST("/auth/logout", h.logout)
	// GET/HEAD /api/auth/me：获取当前用户资料，需要登录。
	protected.Match([]string{"GET", "HEAD"}, "/auth/me", h.me)
	// PATCH /api/auth/me：修改当前用户资料与头像，需要登录。
	protected.PATCH("/auth/me", h.updateProfile)
	// GET/HEAD /api/auth/me/config：读取当前用户的前端自定义配置。
	protected.Match([]string{"GET", "HEAD"}, "/auth/me/config", h.userConfig)
	// PATCH /api/auth/me/config：浅合并当前用户配置，新增和修改共用此接口。
	protected.PATCH("/auth/me/config", h.updateUserConfig)
}
func (h *Handler) writeSession(c *gin.Context, status int, s service.Session) {
	if s.RefreshToken != "" {
		transport.SessionCookie(c.Writer, c.Request, "voex_refresh", "/api/auth", s.RefreshToken, 14*24*60*60)
	}
	transport.SessionCookie(c.Writer, c.Request, "voex_access", "/api", s.AccessToken, s.ExpiresIn)
	c.JSON(status, s)
}
func (h *Handler) accountAvailability(c *gin.Context) {
	h.Limiter.Limit(c.Request, "auth-availability", 60, time.Minute)
	c.JSON(200, shared.Row{"available": h.Service.AccountAvailable(c.Request.Context(), transport.Body(c)["account"])})
}
func (h *Handler) register(c *gin.Context) {
	h.Limiter.Limit(c.Request, "auth-registration", 15, time.Hour)

	h.writeSession(c, 201, h.Service.Register(c.Request.Context(), transport.Body(c)))
}
func (h *Handler) login(c *gin.Context) {
	refundIP := h.Limiter.LimitKey("auth-login-ip:"+security.RateIP(c.Request), 30, 15*time.Minute)
	b := transport.Body(c)
	key := security.RateIP(c.Request)
	if a, ok := b["account"].(string); ok {
		key = shared.Digest(a)
	}
	refundAccount := h.Limiter.LimitKey("auth-login-account:"+key, 10, 15*time.Minute)
	session := h.Service.Login(c.Request.Context(), b, transport.Cookie(c.Request, "voex_refresh"))
	refundIP()
	refundAccount()
	h.writeSession(c, 200, session)
}
func (h *Handler) refresh(c *gin.Context) {
	h.Limiter.Limit(c.Request, "auth-availability", 60, time.Minute)
	defer func() {
		if v := recover(); v != nil {
			if e, ok := v.(shared.HTTPError); ok && e.Message == "登录已过期，请重新登录" {
				transport.ClearSession(c.Writer, c.Request)
			}
			panic(v)
		}
	}()
	h.writeSession(c, 200, h.Service.Refresh(c.Request.Context(), transport.Cookie(c.Request, "voex_refresh")))
}
func (h *Handler) logout(c *gin.Context) {
	h.Service.Logout(c.Request.Context(), transport.AccessToken(c.Request), transport.Cookie(c.Request, "voex_refresh"))
	transport.ClearSession(c.Writer, c.Request)
	c.JSON(200, shared.Row{"success": true})
}
func (h *Handler) me(c *gin.Context) { c.JSON(200, identity.User(c.Request.Context())) }
func (h *Handler) updateProfile(c *gin.Context) {
	c.JSON(200, h.Service.UpdateProfile(c.Request.Context(), transport.Body(c)))
}
func (h *Handler) userConfig(c *gin.Context) {
	c.JSON(200, h.Service.UserConfig(c.Request.Context()))
}
func (h *Handler) updateUserConfig(c *gin.Context) {
	c.JSON(200, h.Service.UpdateUserConfig(c.Request.Context(), transport.Body(c)))
}
