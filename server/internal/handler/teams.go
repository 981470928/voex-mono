package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"voex-server/internal/shared"
	"voex-server/internal/transport"
)

func (h *Handler) RegisterTeamRoutes(public, protected *gin.RouterGroup) {
	// POST /api/team-invites/inspect：公开检查团队邀请链接，限制请求频率。
	public.POST("/team-invites/inspect", h.teamInviteInspect)
	// GET/HEAD /api/teams：需登录，列出当前用户已加入的团队。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/teams", h.teamList)
	// POST /api/teams：需登录，创建普通团队并成为所有者。
	protected.POST("/teams", h.teamCreate)
	// GET/HEAD /api/teams/:key：需团队成员身份，查看团队详情和权限。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/teams/:key", h.teamGet)
	// PATCH /api/teams/:key：需团队所有者或管理员，修改团队名称。
	protected.PATCH("/teams/:key", h.teamUpdate)
	// DELETE /api/teams/:key：仅普通团队所有者可删除已清空项目的团队。
	protected.DELETE("/teams/:key", h.teamDelete)
	// POST /api/teams/:key/transfer：仅普通团队所有者可转让给现有成员。
	protected.POST("/teams/:key/transfer", h.teamTransfer)
	// GET/HEAD /api/teams/:key/members：需团队成员身份，列出团队成员和角色。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/teams/:key/members", h.teamMembers)
	// PATCH /api/teams/:key/members/:userId：仅所有者可设置成员或管理员角色。
	protected.PATCH("/teams/:key/members/:userId", h.teamMemberUpdate)
	// DELETE /api/teams/:key/members/:userId：成员可退出，管理者按权限移除成员。
	protected.DELETE("/teams/:key/members/:userId", h.teamMemberRemove)
	// GET/HEAD /api/teams/:key/invites：需所有者或管理员，查看团队邀请记录。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/teams/:key/invites", h.teamInvites)
	// POST /api/teams/:key/invites：需所有者或管理员，生成团队邀请链接。
	protected.POST("/teams/:key/invites", h.teamInviteCreate)
	// DELETE /api/teams/:key/invites/:id：需所有者或管理员，撤销团队邀请。
	protected.DELETE("/teams/:key/invites/:id", h.teamInviteRevoke)
	// POST /api/team-join-requests：需登录，通过团队编号或邀请提交加入申请。
	protected.POST("/team-join-requests", h.teamJoinRequestCreate)
	// GET/HEAD /api/team-join-requests：需登录，查看本人提交的团队加入申请。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/team-join-requests", h.teamJoinRequestsMine)
	// GET/HEAD /api/teams/:key/join-requests：需所有者或管理员，查看团队待审申请。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/teams/:key/join-requests", h.teamJoinRequests)
	// PATCH /api/teams/:key/join-requests/:id：需所有者或管理员，通过或拒绝申请。
	protected.PATCH("/teams/:key/join-requests/:id", h.teamJoinRequestReview)
}

func (h *Handler) teamInviteInspect(c *gin.Context) {
	h.Limiter.Limit(c.Request, "team-invite", 60, time.Minute)
	c.JSON(http.StatusOK, h.Service.InspectTeamInvite(c.Request.Context(), transport.Body(c)["token"]))
}

func (h *Handler) teamList(c *gin.Context) {
	c.JSON(http.StatusOK, h.Service.ListTeams(c.Request.Context()))
}

func (h *Handler) teamCreate(c *gin.Context) {
	c.JSON(http.StatusCreated, h.Service.CreateTeam(c.Request.Context(), transport.Body(c)["name"]))
}

func (h *Handler) teamGet(c *gin.Context) {
	c.JSON(http.StatusOK, h.Service.GetTeam(c.Request.Context(), c.Param("key")))
}

func (h *Handler) teamUpdate(c *gin.Context) {
	c.JSON(http.StatusOK, h.Service.UpdateTeam(c.Request.Context(), c.Param("key"), transport.Body(c)["name"]))
}

func (h *Handler) teamDelete(c *gin.Context) {
	h.Service.DeleteTeam(c.Request.Context(), c.Param("key"))
	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) teamTransfer(c *gin.Context) {
	h.Service.TransferTeam(c.Request.Context(), c.Param("key"), transport.Body(c)["user_id"])
	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) teamMembers(c *gin.Context) {
	c.JSON(http.StatusOK, h.Service.TeamMembers(c.Request.Context(), c.Param("key")))
}

func (h *Handler) teamMemberUpdate(c *gin.Context) {
	h.Service.UpdateTeamMember(c.Request.Context(), c.Param("key"), c.Param("userId"), transport.Body(c)["role"])
	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) teamMemberRemove(c *gin.Context) {
	h.Service.RemoveTeamMember(c.Request.Context(), c.Param("key"), c.Param("userId"))
	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) teamInvites(c *gin.Context) {
	c.JSON(http.StatusOK, h.Service.TeamInvites(c.Request.Context(), c.Param("key")))
}

func (h *Handler) teamInviteCreate(c *gin.Context) {
	c.JSON(http.StatusCreated, h.Service.CreateTeamInvite(c.Request.Context(), c.Param("key")))
}

func (h *Handler) teamInviteRevoke(c *gin.Context) {
	h.Service.RevokeTeamInvite(c.Request.Context(), c.Param("key"), c.Param("id"))
	c.JSON(http.StatusOK, shared.Row{"success": true})
}

func (h *Handler) teamJoinRequestCreate(c *gin.Context) {
	h.Limiter.Limit(c.Request, "team-invite", 60, time.Minute)
	c.JSON(http.StatusOK, h.Service.RequestTeamJoin(c.Request.Context(), transport.Body(c)))
}

func (h *Handler) teamJoinRequestsMine(c *gin.Context) {
	c.JSON(http.StatusOK, h.Service.MyTeamJoinRequests(c.Request.Context()))
}

func (h *Handler) teamJoinRequests(c *gin.Context) {
	c.JSON(http.StatusOK, h.Service.TeamJoinRequests(c.Request.Context(), c.Param("key")))
}

func (h *Handler) teamJoinRequestReview(c *gin.Context) {
	c.JSON(http.StatusOK, h.Service.ReviewTeamJoinRequest(c.Request.Context(), c.Param("key"), c.Param("id"), transport.Body(c)["status"]))
}
