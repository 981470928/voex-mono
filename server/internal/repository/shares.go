package repository

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"voex-server/internal/dbschema"
	"voex-server/internal/model"
	"voex-server/internal/shared"
)

func DocumentSharing(db *gorm.DB, id any) shared.Row {
	st := dbschema.DocumentSharing
	return One(db.Table(st.Name).Where(st.Columns.DOCUMENT_ID+"=?", id))
}
func SetDocumentSharing(db *gorm.DB, id any, mode string, enabled bool) {
	st := dbschema.DocumentSharing
	var field string
	switch mode {
	case "read":
		field = st.Columns.READ_ENABLED
	case "edit":
		field = st.Columns.EDIT_ENABLED
	default:
		panic("unsupported document sharing mode")
	}
	Must(
		db.Table(st.Name).
			Clauses(clause.OnConflict{
				DoUpdates: clause.Assignments(
					map[string]any{
						field: enabled,
					},
				),
			}).
			Create(map[string]any{st.Columns.DOCUMENT_ID: id, field: enabled}),
	)
}
func DocumentAccessList(db *gorm.DB, id any) []shared.Row {
	at, ut := dbschema.DocumentAccess, dbschema.Users
	access := Rows(
		db.Table(at.Name).
			Select(dbschema.List(at.Columns.USER_ID, at.Columns.PERMISSION)).
			Where(at.Columns.DOCUMENT_ID+"=?", id).
			Order(dbschema.List(at.Columns.GRANTED_AT, at.Columns.USER_ID)),
	)
	users := rowsByKey(
		db.Table(ut.Name).Select(dbschema.List(ut.Columns.ID, ut.Columns.NAME)),
		ut.Columns.ID,
		rowValues(access, at.Columns.USER_ID),
	)
	result := make([]shared.Row, 0, len(access))
	for _, row := range access {
		user := users[shared.String(row[at.Columns.USER_ID])]
		if user == nil {
			continue
		}
		row[ut.Columns.NAME] = user[ut.Columns.NAME]
		result = append(result, row)
	}
	return result
}
func RemoveDocumentAccess(db *gorm.DB, id any, user string) {
	at := dbschema.DocumentAccess
	Must(
		db.Table(at.Name).
			Where(at.Columns.DOCUMENT_ID+"=? AND "+at.Columns.USER_ID+"=?", id, user).
			Delete(&map[string]any{}),
	)
}

func ListSharedAttachments(db *gorm.DB, fileKey string) []shared.Row {
	ft, ut := dbschema.Files, dbschema.Users
	files := Rows(
		db.Table(ft.Name).
			Select(dbschema.List(
				ft.Columns.HASH,
				ft.Columns.NAME,
				ft.Columns.MIME,
				ft.Columns.CREATOR_ID,
			)).
			Where(&model.File{FileKey: fileKey}, ft.Columns.FILE_KEY).
			Order(ft.Columns.ID),
	)
	users := rowsByKey(
		db.Table(ut.Name).Select(dbschema.List(ut.Columns.ID, ut.Columns.NAME)),
		ut.Columns.ID,
		rowValues(files, ft.Columns.CREATOR_ID),
	)
	for _, file := range files {
		user := users[shared.String(file[ft.Columns.CREATOR_ID])]
		file[ft.Columns.CREATOR_ID] = user[ut.Columns.ID]
		file["creator_name"] = user[ut.Columns.NAME]
	}
	return files
}

func SharedCreatorAvatar(db *gorm.DB, assetID string, creatorID any) shared.Row {
	at := dbschema.Assets
	return One(
		db.Table(at.Name).
			Where(at.Columns.ID+
				"=? AND "+
				at.Columns.CREATOR_ID+
				"=? AND "+
				at.Columns.DIRECTORY+
				"='avator' AND "+
				at.Columns.MIME+
				" IN ?", assetID, creatorID, []string{
				"image/png",
				"image/jpeg",
				"image/webp",
			}),
	)
}
