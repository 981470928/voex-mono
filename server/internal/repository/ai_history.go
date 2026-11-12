package repository

import (
	"fmt"
	"strings"
	"voex-server/internal/dbschema"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

// Lists omit the potentially large immutable snapshot; it is fetched by review ID on demand.
// 列表省略可能较大的不可变快照；需要时再按 review ID 获取。
func aiTurnQuery(db *gorm.DB, user string, snapshot, attachmentContent bool) *gorm.DB {
	dt := dbschema.AIConversationTurns
	attachmentFields := dt.Columns.ATTACHMENTS
	if !attachmentContent {
		// At most four attachments are accepted. Strip content in MySQL so a history
		// page never transfers many full-size image payloads into application memory.
		// 最多接受四个附件；在 MySQL 中剔除内容，
		// 避免历史分页将大量完整图片数据载入应用内存。
		var branches []string
		var items []string
		for index := 0; index < 4; index++ {
			items = append(
				items,
				fmt.Sprintf(
					"JSON_REMOVE(JSON_EXTRACT("+
						dt.Columns.ATTACHMENTS+
						", '$[%d]'), '$.text', '$.data')",
					index,
				),
			)
			branches = append(
				branches,
				fmt.Sprintf("WHEN %d THEN JSON_ARRAY(%s)", index+1, strings.Join(items, ", ")),
			)
		}
		attachmentFields = "CASE JSON_LENGTH(" + dt.Columns.ATTACHMENTS + ") " + strings.Join(
			branches,
			" ",
		) + " ELSE JSON_ARRAY() END"
	}
	fields := dbschema.List(
		dt.Columns.ID,
		dt.Columns.USER_ID,
		dt.Columns.DOCUMENT_ID,
		dt.Columns.SESSION_ID,
		dt.Columns.TURN_ID,
		dt.Columns.MODEL_ID,
		dt.Columns.PROMPT,
		attachmentFields+" AS "+dt.Columns.ATTACHMENTS,
		dt.Columns.RESPONSE,
		dt.Columns.ACTIVITY,
		dt.Columns.ERROR,
		dt.Columns.REVIEW_ID,
		dt.Columns.FINISH_HASH,
		dt.Columns.CREATED_AT,
		dt.Columns.COMPLETED_AT,
		"JSON_LENGTH("+dt.Columns.REVIEW_JSON+", '$.changes') AS file_count",
	)
	if snapshot {
		fields = dbschema.List(fields, dt.Columns.REVIEW_JSON)
	}
	return db.Table(dt.Name).Select(fields).Where(dt.Columns.USER_ID+"=?", user)
}

// Read the page first, then enrich only its documents and review IDs.
// 先读取当前分页，再仅补充该页涉及的文档和 review ID 关联数据。
func aiTurnRows(db *gorm.DB, user string, query *gorm.DB) []shared.Row {
	dt := dbschema.AIConversationTurns
	documentDT := dbschema.Documents
	applicationDT := dbschema.AIReviewApplications
	turns := Rows(query)
	documents := rowsByKey(
		db.Table(documentDT.Name).
			Select(dbschema.List(documentDT.Columns.ID, documentDT.Columns.FILE_KEY)),
		documentDT.Columns.ID,
		rowValues(turns, dt.Columns.DOCUMENT_ID),
	)
	applications := rowsByKey(
		db.Table(applicationDT.Name).
			Select(applicationDT.Columns.REVIEW_ID).
			Where(applicationDT.Columns.USER_ID+"=?", user),
		applicationDT.Columns.REVIEW_ID,
		rowValues(turns, dt.Columns.REVIEW_ID),
	)
	result := make([]shared.Row, 0, len(turns))
	for _, turn := range turns {
		if doc := documents[shared.String(turn[dt.Columns.DOCUMENT_ID])]; doc != nil {
			turn["source_key"] = doc[documentDT.Columns.FILE_KEY]
			turn["applied_review_id"] = applications[shared.String(
				turn[dt.Columns.REVIEW_ID],
			)][applicationDT.Columns.REVIEW_ID]
			result = append(result, turn)
		}
	}
	return result
}

func AIConversation(
	db *gorm.DB,
	user string,
	documentID any,
	session string,
	before uint64,
	limit int,
) []shared.Row {
	dt := dbschema.AIConversationTurns
	query := aiTurnQuery(
		db,
		user,
		false,
		false,
	).Where(dt.Columns.DOCUMENT_ID+"=? AND "+dt.Columns.SESSION_ID+"=?", documentID, session)
	if before > 0 {
		query = query.Where(dt.Columns.ID+" < ?", before)
	}
	return aiTurnRows(db, user, query.Order(dt.Columns.ID+" DESC").Limit(limit))
}

func AITurn(db *gorm.DB, user, id string) shared.Row {
	dt := dbschema.AIConversationTurns
	return firstRow(
		aiTurnRows(
			db,
			user,
			aiTurnQuery(db, user, false, true).Where(dt.Columns.TURN_ID+"=?", id).Limit(1),
		),
	)
}

func AIStoredReview(db *gorm.DB, user, id string) shared.Row {
	dt := dbschema.AIConversationTurns
	return firstRow(
		aiTurnRows(
			db,
			user,
			aiTurnQuery(
				db,
				user,
				true,
				false,
			).Where(dt.Columns.REVIEW_ID+"=? AND "+dt.Columns.COMPLETED_AT+" IS NOT NULL", id).
				Limit(1),
		),
	)
}

func InsertAITurn(
	db *gorm.DB,
	user, id string,
	documentID any,
	session, model, prompt, attachments string,
) {
	dt := dbschema.AIConversationTurns
	Must(db.Table(dt.Name).Create(map[string]any{
		dt.Columns.USER_ID:     user,
		dt.Columns.TURN_ID:     id,
		dt.Columns.DOCUMENT_ID: documentID,
		dt.Columns.SESSION_ID:  session,
		dt.Columns.MODEL_ID:    model,
		dt.Columns.PROMPT:      prompt,
		dt.Columns.ATTACHMENTS: attachments,
		dt.Columns.RESPONSE:    "",
		dt.Columns.ACTIVITY:    "[]",
		dt.Columns.ERROR:       "",
	}))
}

func FinishAITurn(db *gorm.DB, user, id string, values shared.Row) {
	dt := dbschema.AIConversationTurns
	values[dt.Columns.COMPLETED_AT] = gorm.Expr("CURRENT_TIMESTAMP(3)")
	Must(
		db.Table(dt.Name).
			Where(dt.Columns.USER_ID+
				"=? AND "+
				dt.Columns.TURN_ID+
				"=? AND "+
				dt.Columns.COMPLETED_AT+
				" IS NULL", user, id).
			Updates(map[string]any(values)),
	)
}

func AISessions(db *gorm.DB, user string, documentID any, before uint64, limit int) []shared.Row {
	dt := dbschema.AIConversationSessions
	query := db.Table(dt.Name).
		Where(dt.Columns.USER_ID+"=? AND "+dt.Columns.DOCUMENT_ID+"=?", user, documentID)
	if before > 0 {
		query = query.Where(dt.Columns.ID+" < ?", before)
	}
	return Rows(query.Order(dt.Columns.ID + " DESC").Limit(limit))
}

func AISession(db *gorm.DB, user string, documentID any, id string) shared.Row {
	dt := dbschema.AIConversationSessions
	return One(
		db.Table(dt.Name).
			Where(dt.Columns.USER_ID+
				"=? AND "+
				dt.Columns.DOCUMENT_ID+
				"=? AND "+
				dt.Columns.SESSION_ID+
				"=?", user, documentID, id),
	)
}

func InsertAISession(db *gorm.DB, user string, documentID any, id, title string) {
	dt := dbschema.AIConversationSessions
	Must(db.Table(dt.Name).Create(map[string]any{
		dt.Columns.USER_ID:     user,
		dt.Columns.DOCUMENT_ID: documentID,
		dt.Columns.SESSION_ID:  id,
		dt.Columns.TITLE:       title,
	}))
}

// The session foreign key cascades turns and snapshots; application records remain intact.
// 会话外键级联删除对话轮次和快照；审阅应用记录保持不变。
func DeleteAISession(db *gorm.DB, user string, documentID any, id string) {
	dt := dbschema.AIConversationSessions
	Must(
		db.Table(dt.Name).
			Where(dt.Columns.USER_ID+
				"=? AND "+
				dt.Columns.DOCUMENT_ID+
				"=? AND "+
				dt.Columns.SESSION_ID+
				"=?", user, documentID, id).
			Delete(&map[string]any{}),
	)
}

func AISessionHasTurns(db *gorm.DB, user string, documentID any, id string) bool {
	dt := dbschema.AIConversationTurns
	return One(
		db.Table(dt.Name).
			Select(dt.Columns.ID).
			Where(dt.Columns.USER_ID+
				"=? AND "+
				dt.Columns.DOCUMENT_ID+
				"=? AND "+
				dt.Columns.SESSION_ID+
				"=?", user, documentID, id),
	) != nil
}

func TouchAISession(db *gorm.DB, user string, documentID any, id, title string) {
	dt := dbschema.AIConversationSessions
	values := map[string]any{dt.Columns.UPDATED_AT: gorm.Expr("CURRENT_TIMESTAMP(3)")}
	if title != "" {
		values[dt.Columns.TITLE] = title
	}
	Must(
		db.Table(dt.Name).
			Where(dt.Columns.USER_ID+
				"=? AND "+
				dt.Columns.DOCUMENT_ID+
				"=? AND "+
				dt.Columns.SESSION_ID+
				"=?", user, documentID, id).
			Updates(values),
	)
}
