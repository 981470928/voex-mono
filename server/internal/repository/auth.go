package repository

import (
	"gorm.io/gorm"
	"voex-server/internal/dbschema"
	"voex-server/internal/model"
	"voex-server/internal/shared"
)

func AuthUserByAccount(db *gorm.DB, account string) shared.Row {
	ut := dbschema.Users
	return One(
		db.Model(&model.User{}).Where(&model.User{Account: []byte(account)}, ut.Columns.ACCOUNT),
	)
}
func AuthUserForSession(db *gorm.DB, userID, sessionID string) shared.Row {
	ut, st := dbschema.Users, dbschema.AuthSessions
	uq, sq := ut.Qualified(), st.Qualified()
	return One(db.Table(ut.Name).Select(ut.Name+".*").
		Joins("JOIN "+st.Name+" ON "+st.Columns.USER_ID+"="+uq.Columns.ID).
		Where(uq.Columns.ID+
			"=? AND "+
			sq.Columns.ID+
			"=? AND "+
			st.Columns.EXPIRES_AT+
			">UTC_TIMESTAMP()", userID, sessionID),
	)
}
func AuthUserForRefresh(db *gorm.DB, hash string) shared.Row {
	ut, st := dbschema.Users, dbschema.AuthSessions
	uq, sq := ut.Qualified(), st.Qualified()
	return One(db.Table(ut.Name).Select(ut.Name+".*,"+sq.Columns.ID+" AS session_id").
		Joins("JOIN "+st.Name+" ON "+st.Columns.USER_ID+"="+uq.Columns.ID).
		Where(st.Columns.REFRESH_HASH+"=? AND "+st.Columns.EXPIRES_AT+">UTC_TIMESTAMP()", hash))
}
func AuthCreateUser(db *gorm.DB, user *model.User) {
	ut := dbschema.Users
	Must(
		db.Select(
			ut.Columns.ID,
			ut.Columns.ACCOUNT,
			ut.Columns.PASSWORD_HASH,
			ut.Columns.NAME,
			ut.Columns.EMAIL,
			ut.Columns.PHONE,
		).
			Create(user),
	)
}
func AuthDeleteExpired(db *gorm.DB) {
	st := dbschema.AuthSessions
	Must(
		db.Exec(
			"DELETE FROM " +
				st.Name +
				" WHERE " +
				st.Columns.EXPIRES_AT +
				"<=UTC_TIMESTAMP() ORDER BY " +
				st.Columns.EXPIRES_AT +
				" LIMIT 1000",
		),
	)
}
func AuthCreateSession(db *gorm.DB, id, userID, hash string) {
	st := dbschema.AuthSessions
	Must(
		db.Model(&model.AuthSession{}).
			Create(map[string]any{
				st.Columns.ID:           id,
				st.Columns.USER_ID:      userID,
				st.Columns.REFRESH_HASH: hash,
				st.Columns.EXPIRES_AT: gorm.Expr(
					"DATE_ADD(UTC_TIMESTAMP(),INTERVAL 14 DAY)",
				),
			}),
	)
}
func AuthRevokeRefresh(db *gorm.DB, hash string) {
	st := dbschema.AuthSessions
	Must(
		db.Where(&model.AuthSession{RefreshHash: hash}, st.Columns.REFRESH_HASH).
			Delete(&model.AuthSession{}),
	)
}
func AuthRevokeAccess(db *gorm.DB, id, userID string) {
	st := dbschema.AuthSessions
	Must(db.Where(&model.AuthSession{
		ID:     id,
		UserID: userID,
	}, st.Columns.ID, st.Columns.USER_ID).Delete(&model.AuthSession{}))
}
func AuthAvatar(db *gorm.DB, id, userID string) shared.Row {
	at := dbschema.Assets
	return One(
		db.Model(&model.Asset{}).
			Select(at.Columns.ID).
			Where(at.Columns.ID+
				"=? AND "+
				at.Columns.CREATOR_ID+
				"=? AND "+
				at.Columns.DIRECTORY+
				"=? AND "+
				at.Columns.MIME+
				" IN ?", id, userID, "avator", []string{
				"image/png",
				"image/jpeg",
				"image/webp",
			}),
	)
}
func AuthUpdateProfile(db *gorm.DB, userID string, values map[string]any) {
	ut := dbschema.Users
	Must(db.Model(&model.User{}).Where(&model.User{ID: userID}, ut.Columns.ID).Updates(values))
}
