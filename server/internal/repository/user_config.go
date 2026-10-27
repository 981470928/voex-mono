package repository

import (
	"voex-server/internal/model"
	"voex-server/internal/shared"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func AuthUserConfig(db *gorm.DB, userID string) shared.Row {
	return One(db.Model(&model.User{}).Select("user_config").Where("id = ?", userID))
}

func AuthUserConfigForUpdate(db *gorm.DB, userID string) shared.Row {
	return AuthUserConfig(db.Clauses(clause.Locking{Strength: "UPDATE"}), userID)
}

func AuthUpdateUserConfig(db *gorm.DB, userID, config string) {
	Must(db.Model(&model.User{}).Where("id = ?", userID).Update("user_config", config))
}
