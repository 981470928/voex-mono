package repository

import (
	"gorm.io/gorm"
	"voex-server/internal/dbschema"
	"voex-server/internal/shared"
)

func AIModels(db *gorm.DB, user string) []shared.Row {
	mt := dbschema.AIModels
	return Rows(
		db.Table(mt.Name).
			Where(mt.Columns.USER_ID+"=?", user).
			Order(dbschema.List(mt.Columns.CREATED_AT, mt.Columns.ID)),
	)
}

func AIModel(db *gorm.DB, user, id string) shared.Row {
	mt := dbschema.AIModels
	return One(db.Table(mt.Name).Where(mt.Columns.USER_ID+"=? AND "+mt.Columns.ID+"=?", user, id))
}

func SaveAIModel(db *gorm.DB, user, id string, values shared.Row, exists bool) {
	mt := dbschema.AIModels
	if exists {
		Must(
			db.Table(mt.Name).
				Where(mt.Columns.USER_ID+"=? AND "+mt.Columns.ID+"=?", user, id).
				Updates(map[string]any(values)),
		)
		return
	}
	values[mt.Columns.ID], values[mt.Columns.USER_ID] = id, user
	Must(db.Table(mt.Name).Create(map[string]any(values)))
}

func DeleteAIModel(db *gorm.DB, user, id string) {
	mt := dbschema.AIModels
	Must(
		db.Table(mt.Name).
			Where(mt.Columns.USER_ID+"=? AND "+mt.Columns.ID+"=?", user, id).
			Delete(&map[string]any{}),
	)
}

func AIApplication(db *gorm.DB, user, id string) shared.Row {
	rt := dbschema.AIReviewApplications
	return One(
		db.Table(rt.Name).Where(rt.Columns.USER_ID+"=? AND "+rt.Columns.REVIEW_ID+"=?", user, id),
	)
}

func RecordAIApplication(db *gorm.DB, user, id, hash, result string) {
	rt := dbschema.AIReviewApplications
	Must(db.Table(rt.Name).Create(map[string]any{
		rt.Columns.USER_ID:      user,
		rt.Columns.REVIEW_ID:    id,
		rt.Columns.PAYLOAD_HASH: hash,
		rt.Columns.RESULT_JSON:  result,
	}))
}
