package service

import (
	"context"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

// Call only after authorizing this document. Share access never exposes a parent.
func documentDetailsDTO(doc, permissions shared.Row, access string) shared.Row {
	var path any
	if access == "project" {
		path = shared.Row{
			"team_key": doc["team_key"], "project_key": doc["project_key"], "project_name": doc["project_name"],
			"folder_key": doc["folder_key"], "folder_name": doc["folder_name"],
		}
	}
	var updatedBy any
	updatedByKind := "unknown"
	if shared.Bool(doc["updated_by_anonymous"]) {
		updatedByKind = "anonymous"
	} else if id := shared.String(doc["updated_by"]); id != "" {
		updatedBy = shared.Row{"id": id, "name": shared.String(doc["updated_by_name"])}
		updatedByKind = "user"
	}
	return shared.Row{
		"file_key": doc["file_key"], "file_name": doc["file_name"],
		"created_at": shared.Timestamp(doc["created_at"]), "updated_at": shared.Timestamp(doc["updated_at"]),
		"updated_by": updatedBy, "updated_by_kind": updatedByKind,
		"access": access, "permissions": permissions, "path": path,
	}
}

// GetDocumentDetails Metadata reads do not fetch document content/attachments or record a visit.
func (s *Service) GetDocumentDetails(ctx context.Context, key string) shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		doc := s.FindDocument(db, ctx, key, "read", false)
		permissions := s.DocumentPermissions(db, ctx, doc)
		access := "share"
		if shared.Bool(s.ProjectPermissions(db, ctx, shared.String(doc["project_key"]))["read"]) {
			access = "project"
		}
		return documentDetailsDTO(doc, permissions, access)
	}).(shared.Row)
}

func (s *Service) GetRecentFileDetails(ctx context.Context, key string) shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		doc, permissions, access := s.findRecentFile(db, ctx, key, "read", false)
		return documentDetailsDTO(doc, permissions, access)
	}).(shared.Row)
}
