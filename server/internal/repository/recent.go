package repository

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"voex-server/internal/dbschema"
	"voex-server/internal/model"
	"voex-server/internal/shared"
)

// A recent record remembers a verified share ID, never the reusable link token.
// 最近访问记录保存已验证的 share ID，不保存可重复使用的链接令牌。
func RecordRecentFile(db *gorm.DB, userID string, doc shared.Row) {
	rt, dt := dbschema.RecentFiles, dbschema.Documents
	values := map[string]any{
		rt.Columns.USER_ID:     userID,
		rt.Columns.DOCUMENT_ID: doc[dt.Columns.ID],
		rt.Columns.FILE_NAME:   doc[dt.Columns.FILE_NAME],
		rt.Columns.VIEWED_AT:   gorm.Expr("CURRENT_TIMESTAMP(6)"),
	}
	updates := map[string]any{
		rt.Columns.FILE_NAME: doc[dt.Columns.FILE_NAME],
		rt.Columns.VIEWED_AT: gorm.Expr("CURRENT_TIMESTAMP(6)"),
	}
	Must(
		db.Table(rt.Name).
			Clauses(clause.OnConflict{DoUpdates: clause.Assignments(updates)}).
			Create(values),
	)
}

func recentFileQuery(db *gorm.DB, userID string, content bool) *gorm.DB {
	rt, dt := dbschema.RecentFiles, dbschema.Documents
	rq, dq := rt.Qualified(), dt.Qualified()
	columns := dbschema.List(
		DocumentColumns,
		rq.Columns.FILE_NAME+" AS viewed_name",
		rt.Columns.VIEWED_AT,
	)
	if content {
		columns = dbschema.List(columns, dt.Columns.FILE_CONTENT)
	}
	return DocumentQuery(db, false).Select(columns).
		Joins("JOIN "+
			rt.Name+
			" ON "+
			rt.Columns.DOCUMENT_ID+
			"="+
			dq.Columns.ID+
			" AND "+
			rt.Columns.USER_ID+
			"=?", userID)
}

func RecentFiles(db *gorm.DB, userID string, limit int) []shared.Row {
	rt := dbschema.RecentFiles
	return documentRows(
		db,
		recentFileQuery(
			db,
			userID,
			false,
		).Order(rt.Columns.VIEWED_AT+" DESC,"+rt.Columns.DOCUMENT_ID+" DESC").
			Limit(limit),
	)
}

// Read a fresh boundary, then delete by the current viewed_at value in autocommit.
// A concurrent visit newer than the boundary no longer matches the DELETE;
// concurrent changes may leave extra rows for the next cleanup attempt.
// 读取最新边界后，在自动提交模式下按当前 viewed_at 值删除。
// 晚于该边界的并发访问不再匹配 DELETE；
// 并发变更可能留下额外记录，由下次清理处理。
func PruneRecentFiles(db *gorm.DB, userID string, limit int) {
	rt := dbschema.RecentFiles
	boundary := One(
		db.Table(rt.Name).Select(dbschema.List(rt.Columns.VIEWED_AT, rt.Columns.DOCUMENT_ID)).
			Where(&model.RecentFile{UserID: userID}, rt.Columns.USER_ID).
			Order(rt.Columns.VIEWED_AT + " DESC," + rt.Columns.DOCUMENT_ID + " DESC").
			Offset(limit - 1),
	)
	if boundary == nil {
		return
	}
	Must(
		db.Table(rt.Name).Where(
			rt.Columns.USER_ID+
				"=? AND ("+
				rt.Columns.VIEWED_AT+
				" < ? OR ("+
				rt.Columns.VIEWED_AT+
				" = ? AND "+
				rt.Columns.DOCUMENT_ID+
				" < ?))",
			userID,
			boundary[rt.Columns.VIEWED_AT],
			boundary[rt.Columns.VIEWED_AT],
			boundary[rt.Columns.DOCUMENT_ID],
		).
			Delete(
				&map[string]any{},
			),
	)
}

func RecentFileByKey(db *gorm.DB, userID, key string, content bool) shared.Row {
	doc := DocumentByKey(db, key, content)
	if doc == nil {
		return nil
	}
	rt, dt := dbschema.RecentFiles, dbschema.Documents
	recent := One(
		db.Table(rt.Name).
			Select(dbschema.List(rt.Columns.FILE_NAME, rt.Columns.VIEWED_AT)).
			Where(rt.Columns.USER_ID+
				"=? AND "+
				rt.Columns.DOCUMENT_ID+
				"=?", userID, doc[dt.Columns.ID]),
	)
	if recent == nil {
		return nil
	}
	doc["viewed_name"],
		doc[rt.Columns.VIEWED_AT] =
		recent[rt.Columns.FILE_NAME],
		recent[rt.Columns.VIEWED_AT]
	return doc
}

func RemoveRecentFile(db *gorm.DB, userID, key string) {
	rt, dt := dbschema.RecentFiles, dbschema.Documents
	Must(
		db.Table(rt.Name).
			Where(rt.Columns.USER_ID+"=? AND "+rt.Columns.DOCUMENT_ID+" IN (?)", userID,
				db.Table(dt.Name).
					Select(dt.Columns.ID).
					Where(&model.Document{FileKey: key}, dt.Columns.FILE_KEY),
			).
			Delete(&map[string]any{}),
	)
}
