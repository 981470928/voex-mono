package repository

import (
	"gorm.io/gorm"
	"voex-server/internal/shared"
)

func AIModels(db *gorm.DB, user string) []shared.Row {
	return Rows(db.Table("ai_models").Where("user_id=?", user).Order("created_at, id"))
}

func AIModel(db *gorm.DB, user, id string) shared.Row {
	return One(db.Table("ai_models").Where("user_id=? AND id=?", user, id))
}

func SaveAIModel(db *gorm.DB, user, id string, values shared.Row, exists bool) {
	if exists {
		Must(db.Table("ai_models").Where("user_id=? AND id=?", user, id).Updates(map[string]any(values)))
		return
	}
	values["id"], values["user_id"] = id, user
	Must(db.Table("ai_models").Create(map[string]any(values)))
}

func DeleteAIModel(db *gorm.DB, user, id string) {
	Must(db.Table("ai_models").Where("user_id=? AND id=?", user, id).Delete(&map[string]any{}))
}

func AIApplication(db *gorm.DB, user, id string) shared.Row {
	return One(db.Table("ai_review_applications").Where("user_id=? AND review_id=?", user, id))
}

func RecordAIApplication(db *gorm.DB, user, id, hash, result string) {
	Must(db.Table("ai_review_applications").Create(map[string]any{
		"user_id": user, "review_id": id, "payload_hash": hash, "result_json": result,
	}))
}
