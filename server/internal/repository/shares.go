package repository

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"voex-server/internal/shared"
)

func DocumentSharing(db *gorm.DB, id any) shared.Row {
	return One(db.Table("document_sharing").Where("document_id=?", id))
}
func SetDocumentSharing(db *gorm.DB, id any, mode string, enabled bool) {
	field := mode + "_enabled"
	Must(db.Table("document_sharing").Clauses(clause.OnConflict{DoUpdates: clause.Assignments(map[string]any{field: enabled})}).Create(map[string]any{"document_id": id, field: enabled}))
}
func DocumentAccessList(db *gorm.DB, id any) []shared.Row {
	return Rows(db.Table("document_access AS a").Select("a.user_id,a.permission,u.name").Joins("JOIN users u ON u.id=a.user_id").Where("a.document_id=?", id).Order("a.granted_at,a.user_id"))
}
func RemoveDocumentAccess(db *gorm.DB, id any, user string) {
	Must(db.Table("document_access").Where("document_id=? AND user_id=?", id, user).Delete(&map[string]any{}))
}

func ListSharedAttachments(db *gorm.DB, fileKey string) []shared.Row {
	return Rows(db.Table("files AS f").Select("f.hash,f.name,f.mime,u.id AS creator_id,u.name AS creator_name").Joins("LEFT JOIN users u ON u.id=f.creator_id").Where("f.file_key=?", fileKey).Order("f.id"))
}

func SharedCreatorAvatar(db *gorm.DB, assetID string, creatorID any) shared.Row {
	return One(db.Table("assets").Where("id=? AND creator_id=? AND directory='avator' AND mime IN ?", assetID, creatorID, []string{"image/png", "image/jpeg", "image/webp"}))
}
