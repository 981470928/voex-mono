package repository

import (
	"voex-server/internal/dbschema"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

func documentVersionColumns() string {
	dt := dbschema.DocumentVersions
	return dbschema.List(
		dt.Columns.ID,
		dt.Columns.DOCUMENT_ID,
		dt.Columns.REVISION,
		dt.Columns.KIND,
		dt.Columns.LABEL,
		dt.Columns.CONTENT_HASH,
		dt.Columns.SCHEMA_VERSION,
		dt.Columns.CREATED_BY,
		dt.Columns.CREATED_BY_ANONYMOUS,
		dt.Columns.CREATED_AT,
	)
}

// documentVersionQuery 按 document_id 作用域查询版本；正文由调用方按需附加。
func documentVersionQuery(db *gorm.DB) *gorm.DB {
	dt := dbschema.DocumentVersions
	return db.Table(dt.Name).Select(documentVersionColumns())
}

func documentVersionRows(db *gorm.DB, query *gorm.DB) []shared.Row {
	dt := dbschema.DocumentVersions
	userDT := dbschema.Users
	versions := Rows(query)
	users := rowsByKey(
		db.Table(userDT.Name).
			Select(dbschema.List(userDT.Columns.ID, userDT.Columns.NAME, userDT.Columns.AVATOR)),
		userDT.Columns.ID,
		rowValues(versions, dt.Columns.CREATED_BY),
	)
	for _, version := range versions {
		user := users[shared.String(version[dt.Columns.CREATED_BY])]
		version["created_by_name"],
			version["created_by_avator"] =
			user[userDT.Columns.NAME],
			user[userDT.Columns.AVATOR]
	}
	return versions
}

// DocumentVersions 列出版本元数据（不含正文），按 id 倒序；beforeID 为游标，仅返回更早的版本。
func DocumentVersions(db *gorm.DB, documentID any, limit int64, beforeID int64) []shared.Row {
	dt := dbschema.DocumentVersions
	query := documentVersionQuery(
		db,
	).Where(dt.Columns.DOCUMENT_ID+"=?", documentID).
		Order(dt.Columns.ID + " DESC").
		Limit(int(limit))
	if beforeID > 0 {
		query = query.Where(dt.Columns.ID+"<?", beforeID)
	}
	return documentVersionRows(db, query)
}

// DocumentVersion 读取属于指定文档的单个版本（含正文）。
func DocumentVersion(db *gorm.DB, documentID any, id int64) shared.Row {
	dt := dbschema.DocumentVersions
	return firstRow(
		documentVersionRows(
			db,
			documentVersionQuery(
				db,
			).Select(dbschema.List(documentVersionColumns(), dt.Columns.CONTENT)).
				Where(dt.Columns.DOCUMENT_ID+"=? AND "+dt.Columns.ID+"=?", documentID, id).
				Limit(1),
		),
	)
}

// LatestDocumentVersion 返回该文档最近一个版本，用于快照阈值与去重判断。
func LatestDocumentVersion(db *gorm.DB, documentID any) shared.Row {
	dt := dbschema.DocumentVersions
	return firstRow(
		documentVersionRows(
			db,
			documentVersionQuery(
				db,
			).Where(dt.Columns.DOCUMENT_ID+"=?", documentID).
				Order(dt.Columns.ID+" DESC").
				Limit(1),
		),
	)
}

// InsertDocumentVersion 插入版本行并返回新行 id；LAST_INSERT_ID 作用于当前事务连接，全局并发下仍正确。
func InsertDocumentVersion(db *gorm.DB, values shared.Row) int64 {
	dt := dbschema.DocumentVersions
	row := map[string]any{}
	for field, value := range values {
		row[field] = value
	}
	Must(db.Table(dt.Name).Create(row))
	return shared.Int64(
		One(db.Raw("SELECT LAST_INSERT_ID() AS " + dt.Columns.ID + " LIMIT 1"))[dt.Columns.ID],
	)
}

// DeleteDocumentVersion 仅删除命名版本；其他类型由调用方预先拒绝。
func DeleteDocumentVersion(db *gorm.DB, documentID any, id int64) {
	dt := dbschema.DocumentVersions
	Must(
		db.Table(dt.Name).
			Where(dt.Columns.DOCUMENT_ID+
				"=? AND "+
				dt.Columns.ID+
				"=? AND "+
				dt.Columns.KIND+
				"='manual'", documentID, id).
			Delete(&map[string]any{}),
	)
}

// CountAutoDocumentVersions 统计单文档的自动快照数量，用于上限保险丝。
func CountAutoDocumentVersions(db *gorm.DB, documentID any) int64 {
	dt := dbschema.DocumentVersions
	return shared.Int64(
		One(
			db.Table(
				dt.Name,
			).Select(
				"COUNT(*) AS count",
			).Where(
				dt.Columns.DOCUMENT_ID+"=? AND "+dt.Columns.KIND+"='auto'",
				documentID,
			),
		)["count"],
	)
}

// OverflowDocumentVersions 取自动快照数量超过 keep 的文档 id，供上限裁剪分批处理。
func OverflowDocumentVersions(db *gorm.DB, keep int64, limit int) []shared.Row {
	dt := dbschema.DocumentVersions
	return Rows(
		db.Raw(
			"SELECT "+dt.Columns.DOCUMENT_ID+" FROM ("+
				" SELECT "+
				dt.Columns.DOCUMENT_ID+
				", COUNT(*) AS total FROM "+
				dt.Name+
				" WHERE "+
				dt.Columns.KIND+
				"='auto' GROUP BY "+
				dt.Columns.DOCUMENT_ID+
				" ) counted WHERE total > ? ORDER BY "+dt.Columns.DOCUMENT_ID+" LIMIT ?",
			keep,
			limit,
		),
	)
}

// AutoVersionIDs 按升序取自动快照 id；清理任务用它分批取得最旧的候选行。
func AutoVersionIDs(db *gorm.DB, documentID any, limit int) []int64 {
	dt := dbschema.DocumentVersions
	rows := Rows(db.Table(dt.Name).Select(dt.Columns.ID).
		Where(dt.Columns.DOCUMENT_ID+"=? AND "+dt.Columns.KIND+"='auto'", documentID).
		Order(dt.Columns.ID).Limit(limit))
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, shared.Int64(row[dt.Columns.ID]))
	}
	return ids
}

// ExpiredAutoVersionIDs 取早于指定时间的自动快照 id，供整档删除分批处理。
func ExpiredAutoVersionIDs(db *gorm.DB, beforeAge string, limit int) []int64 {
	dt := dbschema.DocumentVersions
	rows := Rows(
		db.Raw(
			"SELECT "+dt.Columns.ID+" FROM "+dt.Name+
				" WHERE "+
				dt.Columns.KIND+
				"='auto' AND "+
				dt.Columns.CREATED_AT+
				" < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL "+
				beforeAge+
				") ORDER BY "+dt.Columns.ID+" LIMIT ?",
			limit,
		),
	)
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, shared.Int64(row[dt.Columns.ID]))
	}
	return ids
}

// ThinnedAutoVersionIDs 返回时间窗口内每个（文档, 时间桶）中除最新以外的自动快照 id。
// 桶粒度由 bucket 表达式决定；MySQL 8 窗口函数在同一分区内保留最大 id。
func ThinnedAutoVersionIDs(db *gorm.DB, bucket, newerThan, olderThan string, limit int) []int64 {
	dt := dbschema.DocumentVersions
	rows := Rows(
		db.Raw(
			"SELECT "+dt.Columns.ID+" FROM ("+
				" SELECT "+
				dt.Columns.ID+
				", ROW_NUMBER() OVER (PARTITION BY "+
				dt.Columns.DOCUMENT_ID+
				", "+
				bucket+
				" ORDER BY "+
				dt.Columns.ID+
				" DESC) AS ranked"+
				" FROM "+dt.Name+
				" WHERE "+
				dt.Columns.KIND+
				"='auto' AND "+
				dt.Columns.CREATED_AT+
				" >= DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL "+
				newerThan+
				") AND "+
				dt.Columns.CREATED_AT+
				" < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL "+
				olderThan+
				") ) windowed WHERE ranked > 1 ORDER BY "+dt.Columns.ID+" LIMIT ?",
			limit,
		),
	)
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, shared.Int64(row[dt.Columns.ID]))
	}
	return ids
}

// DeleteDocumentVersions 仅批量删除自动版本，命名与保护版本不参与清理。
func DeleteDocumentVersions(db *gorm.DB, ids []int64) int64 {
	if len(ids) == 0 {
		return 0
	}
	dt := dbschema.DocumentVersions
	result := Must(
		db.Table(dt.Name).
			Where(dt.Columns.KIND+"='auto' AND "+dt.Columns.ID+" IN ?", ids).
			Delete(&map[string]any{}),
	)
	return result.RowsAffected
}
