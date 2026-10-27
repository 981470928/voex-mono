// Package identity carries the authenticated principal without depending on Gin.
package identity

import (
	"context"
	"voex-server/internal/shared"
)

type contextKey struct{}
type Session struct {
	User shared.Row
	ID   string
}

func WithUser(ctx context.Context, user shared.Row, id string) context.Context {
	return context.WithValue(ctx, contextKey{}, Session{User: user, ID: id})
}
func OptionalUser(ctx context.Context) shared.Row {
	v, ok := ctx.Value(contextKey{}).(Session)
	if !ok {
		return nil
	}
	return v.User
}
func User(ctx context.Context) shared.Row {
	u := OptionalUser(ctx)
	if u == nil {
		shared.Fail(401, "请先登录")
	}
	return u
}

func SessionID(ctx context.Context) string { v, _ := ctx.Value(contextKey{}).(Session); return v.ID }
