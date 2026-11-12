// Package handler translates Gin requests and responses to service operations.
// handler 包将 Gin 请求和响应转换为 service 层操作。
package handler

import (
	"voex-server/internal/security"
	"voex-server/internal/service"
)

type Handler struct {
	Service *service.Service
	Limiter *security.Limiter
}

func New(
	s *service.Service,
	l *security.Limiter,
) *Handler {
	return &Handler{Service: s, Limiter: l}
}
