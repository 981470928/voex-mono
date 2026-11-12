package repository

import (
	"gorm.io/gorm"
	"voex-server/internal/dbschema"
	"voex-server/internal/model"
	"voex-server/internal/shared"
)

// Archive metadata is read in the same snapshot as the document and Yjs state.
// 归档元数据与文档、Yjs 状态在同一个快照中读取。
func TransferAttachments(db *gorm.DB, key string) []shared.Row {
	ft := dbschema.Files
	return Rows(
		db.Table(ft.Name).
			Select(dbschema.List(
				ft.Columns.HASH,
				ft.Columns.NAME,
				ft.Columns.MIME,
				ft.Columns.SIZE,
			)).
			Where(&model.File{FileKey: key}, ft.Columns.FILE_KEY).
			Order(ft.Columns.ID + " ASC"),
	)
}

// Include tombstones so retrying an import never silently restores a deleted document.
// 包含删除标记，防止重试导入时悄然恢复已删除的文档。
func TransferDocumentByKey(db *gorm.DB, key string) shared.Row {
	dt := dbschema.Documents
	return One(
		db.Table(dt.Name).
			Select(dbschema.List(
				dt.Columns.ID,
				dt.Columns.FILE_KEY,
				dt.Columns.FILE_NAME,
				dt.Columns.CREATOR_ID,
				dt.Columns.FOLDER_ID,
				dt.Columns.DELETED_AT,
			)).
			Where(&model.Document{FileKey: key}, dt.Columns.FILE_KEY),
	)
}
