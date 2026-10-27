package repository

import (
	"gorm.io/gorm"
	"voex-server/internal/model"
	"voex-server/internal/shared"
)

func AuthUserByAccount(db *gorm.DB, account string) shared.Row {
	return One(db.Model(&model.User{}).Where("account = ?", []byte(account)))
}
func AuthUserForSession(db *gorm.DB, userID, sessionID string) shared.Row {
	return One(db.Table("users AS u").Select("u.*").Joins("JOIN auth_sessions AS s ON s.user_id=u.id").Where("u.id=? AND s.id=? AND s.expires_at>UTC_TIMESTAMP()", userID, sessionID))
}
func AuthUserForRefresh(db *gorm.DB, hash string) shared.Row {
	return One(db.Table("users AS u").Select("u.*,s.id AS session_id").Joins("JOIN auth_sessions AS s ON s.user_id=u.id").Where("s.refresh_hash=? AND s.expires_at>UTC_TIMESTAMP()", hash))
}
func AuthCreateUser(db *gorm.DB, user *model.User) {
	Must(db.Select("id", "account", "password_hash", "name", "email", "phone").Create(user))
}
func AuthDeleteExpired(db *gorm.DB) {
	Must(db.Where("expires_at<=UTC_TIMESTAMP()").Delete(&model.AuthSession{}))
}
func AuthCreateSession(db *gorm.DB, id, userID, hash string) {
	Must(db.Model(&model.AuthSession{}).Create(map[string]any{"id": id, "user_id": userID, "refresh_hash": hash, "expires_at": gorm.Expr("DATE_ADD(UTC_TIMESTAMP(),INTERVAL 14 DAY)")}))
}
func AuthRevokeRefresh(db *gorm.DB, hash string) {
	Must(db.Where("refresh_hash=?", hash).Delete(&model.AuthSession{}))
}
func AuthRevokeAccess(db *gorm.DB, id, userID string) {
	Must(db.Where("id=? AND user_id=?", id, userID).Delete(&model.AuthSession{}))
}
func AuthAvatar(db *gorm.DB, id, userID string) shared.Row {
	return One(db.Model(&model.Asset{}).Select("id").Where("id=? AND creator_id=? AND directory=? AND mime IN ?", id, userID, "avator", []string{"image/png", "image/jpeg", "image/webp"}))
}
func AuthUpdateProfile(db *gorm.DB, userID string, values map[string]any) {
	Must(db.Model(&model.User{}).Where("id=?", userID).Updates(values))
}
