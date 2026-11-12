package repository

import (
	"voex-server/internal/dbschema"
	"voex-server/internal/model"
	"voex-server/internal/shared"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func AuthUserConfig(db *gorm.DB, userID string) shared.Row {
	ut := dbschema.Users
	return One(
		db.Model(&model.User{}).
			Select(ut.Columns.USER_CONFIG).
			Where(&model.User{ID: userID}, ut.Columns.ID),
	)
}

func AuthUserConfigForUpdate(db *gorm.DB, userID string) shared.Row {
	return AuthUserConfig(db.Clauses(clause.Locking{Strength: "UPDATE"}), userID)
}

func AuthUpdateUserConfig(db *gorm.DB, userID, config string) {
	ut := dbschema.Users
	Must(
		db.Model(&model.User{}).
			Where(&model.User{ID: userID}, ut.Columns.ID).
			Update(ut.Columns.USER_CONFIG, config),
	)
}
