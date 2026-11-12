package repository

import (
	"gorm.io/gorm"
	"voex-server/internal/dbschema"
	"voex-server/internal/model"
	"voex-server/internal/shared"
)

func CreateAsset(db *gorm.DB, asset shared.Row) {
	at := dbschema.Assets
	Must(db.Table(at.Name).Create(map[string]any(asset)))
}

func AccessibleAsset(db *gorm.DB, id, userID string) shared.Row {
	at, ut := dbschema.Assets, dbschema.Users
	aq := at.Qualified()
	om, vm := dbschema.TeamMembers.As("owner_member"), dbschema.TeamMembers.As("viewer_member")
	access := at.Columns.CREATOR_ID +
		"=? OR (" +
		at.Columns.DIRECTORY +
		"='avator' AND EXISTS (SELECT 1 FROM " +
		ut.Name +
		" JOIN " + om.Name + " ON " + om.Columns.USER_ID + "=" + ut.Columns.ID +
		" JOIN " + vm.Name + " ON " + vm.Columns.TEAM_ID + "=" + om.Columns.TEAM_ID +
		" WHERE " +
		ut.Columns.ID +
		"=" +
		aq.Columns.CREATOR_ID +
		" AND " +
		ut.Columns.AVATOR +
		"=CONCAT('/api/assets/'," +
		aq.Columns.ID +
		") AND " +
		vm.Columns.USER_ID +
		"=?))"
	return One(
		db.Table(at.Name).
			Select("*").
			Where(&model.Asset{ID: id}, at.Columns.ID).
			Where(access, userID, userID),
	)
}

func CreateAttachment(db *gorm.DB, file shared.Row) {
	ft := dbschema.Files
	Must(db.Table(ft.Name).Create(map[string]any(file)))
}

func AttachmentByHash(db *gorm.DB, fileKey, hash string) shared.Row {
	ft := dbschema.Files
	return One(
		db.Table(ft.Name).
			Select(dbschema.List(
				ft.Columns.ID,
				ft.Columns.HASH,
				ft.Columns.NAME,
				ft.Columns.MIME,
				ft.Columns.SIZE,
			)).
			Where(&model.File{
				FileKey: fileKey,
				Hash:    hash,
			}, ft.Columns.FILE_KEY, ft.Columns.HASH),
	)
}

func ListAttachments(db *gorm.DB, fileKey string) []shared.Row {
	ft, ut := dbschema.Files, dbschema.Users
	files := Rows(
		db.Table(ft.Name).
			Select(dbschema.List(
				ft.Columns.HASH,
				ft.Columns.NAME,
				ft.Columns.MIME,
				ft.Columns.CREATOR_ID,
			)).
			Where(&model.File{FileKey: fileKey}, ft.Columns.FILE_KEY),
	)
	users := rowsByKey(
		db.Table(ut.Name).Select(dbschema.List(ut.Columns.ID, ut.Columns.NAME, ut.Columns.AVATOR)),
		ut.Columns.ID,
		rowValues(files, ft.Columns.CREATOR_ID),
	)
	for _, file := range files {
		user := users[shared.String(file[ft.Columns.CREATOR_ID])]
		file["creator_name"] = user[ut.Columns.NAME]
		file["creator_avator"] = user[ut.Columns.AVATOR]
	}
	return files
}

func DeleteAttachment(db *gorm.DB, fileKey, hash string) {
	ft := dbschema.Files
	Must(db.Table(ft.Name).Where(&model.File{
		FileKey: fileKey,
		Hash:    hash,
	}, ft.Columns.FILE_KEY, ft.Columns.HASH).Delete(&map[string]any{}))
}
