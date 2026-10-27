package repository

import (
	"gorm.io/gorm"
	"voex-server/internal/shared"
)

func CreateAsset(db *gorm.DB, asset shared.Row) {
	Must(db.Table("assets").Create(map[string]any(asset)))
}

func AccessibleAsset(db *gorm.DB, id, userID string) shared.Row {
	return One(db.Table("assets AS a").Select("a.*").Where("a.id=?", id).Where(`a.creator_id=? OR (a.directory='avator' AND EXISTS (SELECT 1 FROM users u JOIN team_members owner_member ON owner_member.user_id=u.id JOIN team_members viewer_member ON viewer_member.team_id=owner_member.team_id WHERE u.id=a.creator_id AND u.avator=CONCAT('/api/assets/',a.id) AND viewer_member.user_id=?))`, userID, userID))
}

func CreateAttachment(db *gorm.DB, file shared.Row) {
	Must(db.Table("files").Create(map[string]any(file)))
}

func AttachmentByHash(db *gorm.DB, fileKey, hash string) shared.Row {
	return One(db.Table("files").Select("id,hash,name,mime,size").Where("file_key=? AND hash=?", fileKey, hash))
}

func ListAttachments(db *gorm.DB, fileKey string) []shared.Row {
	return Rows(db.Table("files AS f").Select("f.hash,f.name,f.mime,f.creator_id,u.name AS creator_name,u.avator AS creator_avator").Joins("LEFT JOIN users u ON u.id=f.creator_id").Where("f.file_key=?", fileKey))
}

func DeleteAttachment(db *gorm.DB, fileKey, hash string) {
	Must(db.Table("files").Where("file_key=? AND hash=?", fileKey, hash).Delete(&map[string]any{}))
}
