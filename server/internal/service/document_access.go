package service

import (
	"context"
	"gorm.io/gorm"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"
)

func (s *Service) documentPermissions(db *gorm.DB, ctx context.Context, doc, project shared.Row) shared.Row {
	grant := ""
	if !shared.Bool(project["write"]) {
		grant = repository.DocumentAccess(db, doc["id"], shared.String(identity.User(ctx)["id"]))
	}
	write := shared.Bool(project["write"]) || grant == "edit"
	return shared.Row{"read": write || shared.Bool(project["read"]) || grant == "read", "write": write,
		"share": write, "manage": shared.Bool(project["write"]), "remove": shared.Bool(project["children_remove"])}
}
func (s *Service) DocumentPermissions(db *gorm.DB, ctx context.Context, doc shared.Row) shared.Row {
	return s.documentPermissions(db, ctx, doc, s.ProjectPermissions(db, ctx, shared.String(doc["project_key"])))
}
