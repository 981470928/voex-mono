package handler

import (
	"net/http"
	"strconv"
	"strings"
	"voex-server/internal/shared"

	"github.com/gin-gonic/gin"
)

// RegisterSearchRoutes 注册全文搜索接口；全部需要登录。
func (h *Handler) RegisterSearchRoutes(protected *gin.RouterGroup) {
	// GET/HEAD：按关键字全文搜索当前团队可读文档，返回命中摘录而非正文。
	protected.Match([]string{http.MethodGet, http.MethodHead}, "/search", h.searchDocuments)
}

func (h *Handler) searchDocuments(c *gin.Context) {
	value, present := workspaceQueryValue(c, "q")
	text := ""
	if present {
		var valid bool
		text, valid = value.(string)
		if !valid {
			shared.Fail(http.StatusBadRequest, shared.MustBeMessage("搜索关键字", shared.MsgStringType))
		}
	}
	query := shared.Characters(strings.TrimSpace(text), "搜索关键字", 2, 100)
	teamKey := ""
	if value, present := workspaceQueryValue(c, "team_key"); present {
		teamKey = shared.Key(value, "团队标识")
	}
	limit := int64(20)
	if value, present := workspaceQueryValue(c, "limit"); present {
		text, valid := value.(string)
		number, err := strconv.ParseInt(text, 10, 64)
		if !valid || err != nil || number < 1 || number > 50 {
			shared.Fail(http.StatusBadRequest, shared.IntegerRangeMessage("limit", 1, 50))
		}
		limit = number
	}
	offset := int64(0)
	if value, present := workspaceQueryValue(c, "offset"); present {
		text, valid := value.(string)
		number, err := strconv.ParseInt(text, 10, 64)
		if !valid || err != nil || number < 0 {
			shared.Fail(
				http.StatusBadRequest,
				shared.MustBeMessage("offset", shared.MsgNonNegativeInteger),
			)
		}
		offset = number
	}
	c.JSON(
		http.StatusOK,
		h.Service.SearchDocuments(c.Request.Context(), teamKey, query, limit, offset),
	)
}
