package repository

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"voex-server/internal/dbschema"
	"voex-server/internal/shared"
)

// Upserts may upgrade read to edit, but must never downgrade an existing editor.
// Upsert 可将只读权限升级为编辑权限，但不得降低已有编辑者权限。
func GrantDocumentAccess(db *gorm.DB, documentID any, userID, permission string) {
	at := dbschema.DocumentAccess
	Must(db.Table(at.Name).Clauses(clause.OnConflict{DoUpdates: clause.Assignments(map[string]any{
		at.Columns.PERMISSION: gorm.Expr(
			"IF("+at.Columns.PERMISSION+" = 'edit' OR ? = 'edit', 'edit', 'read')",
			permission,
		),
	})}).Create(map[string]any{
		at.Columns.DOCUMENT_ID: documentID,
		at.Columns.USER_ID:     userID,
		at.Columns.PERMISSION:  permission,
	}))
}

func DocumentAccess(db *gorm.DB, documentID any, userID string) string {
	at := dbschema.DocumentAccess
	row := One(
		db.Table(at.Name).
			Select(at.Columns.PERMISSION).
			Where(at.Columns.DOCUMENT_ID+"=? AND "+at.Columns.USER_ID+"=?", documentID, userID),
	)
	return shared.String(row[at.Columns.PERMISSION])
}
