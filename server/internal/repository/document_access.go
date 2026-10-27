package repository

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"voex-server/internal/shared"
)

// Upserts may upgrade read to edit, but must never downgrade an existing editor.
func GrantDocumentAccess(db *gorm.DB, documentID any, userID, permission string) {
	Must(db.Table("document_access").Clauses(clause.OnConflict{DoUpdates: clause.Assignments(map[string]any{
		"permission": gorm.Expr("IF(document_access.permission = 'edit' OR ? = 'edit', 'edit', 'read')", permission),
	})}).Create(map[string]any{
		"document_id": documentID, "user_id": userID, "permission": permission,
	}))
}

func DocumentAccess(db *gorm.DB, documentID any, userID string) string {
	row := One(db.Table("document_access").Select("permission").Where("document_id=? AND user_id=?", documentID, userID))
	return shared.String(row["permission"])
}
