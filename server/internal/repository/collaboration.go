package repository

import (
	"context"
	"database/sql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"voex-server/internal/dbschema"
	"voex-server/internal/model"
	"voex-server/internal/shared"
)

// Binary state must never pass through Rows, which intentionally converts []byte to text.
// 二进制状态不得经过 Rows，因为 Rows 会有意将 []byte 转换为文本。
type CollaborationState struct {
	DocumentID    int64  `gorm:"column:document_id"`
	State         []byte `gorm:"column:state"`
	SchemaVersion string `gorm:"column:schema_version"`
	Epoch         int64  `gorm:"column:epoch"`
	CollabSeq     int64  `gorm:"column:collab_seq"`
}

func LoadCollaboration(db *gorm.DB, id any) *CollaborationState {
	ct := dbschema.DocumentCollaboration
	var state CollaborationState
	result := db.Table(ct.Name).Where(ct.Columns.DOCUMENT_ID+"=?", id).Take(&state)
	if result.Error == gorm.ErrRecordNotFound {
		return nil
	}
	Must(result)
	return &state
}
func CollaborationMode(db *gorm.DB, key string) string {
	dt := dbschema.Documents
	row := One(
		db.Table(dt.Name).
			Select(dt.Columns.CONTENT_MODE).
			Where(&model.Document{FileKey: key}, dt.Columns.FILE_KEY),
	)
	return shared.String(row[dt.Columns.CONTENT_MODE])
}

// SHARE locks permit concurrent document commits. ACL/legacy writers take UPDATE
// on the same row first, then document locks: one consistent lock order.
// SHARE 锁允许文档并发提交；修改 ACL 或旧版文档的操作先在同一行获取 UPDATE 锁，
// 再获取文档锁，以保持一致的加锁顺序。
func CollaborationTransaction(
	ctx context.Context,
	db *gorm.DB,
	key string,
	fn func(*gorm.DB) any,
) any {
	var result any
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		wt := dbschema.WorkspaceState
		if One(
			tx.Table(wt.Name).
				Where(&model.WorkspaceState{ID: 1}, wt.Columns.ID).
				Clauses(clause.Locking{Strength: "SHARE"}),
		) == nil {
			panic("workspace lock missing")
		}
		LockCollaborationDocument(tx, key)
		result = fn(tx)
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	shared.Must(err)
	return result
}
func LockCollaborationDocument(db *gorm.DB, key string) {
	dt := dbschema.Documents
	if One(
		db.Table(dt.Name).
			Select(dt.Columns.ID).
			Where(dt.Columns.FILE_KEY+"=? AND "+dt.Columns.DELETED_AT+" IS NULL", key).
			Clauses(clause.Locking{Strength: "UPDATE"}),
	) == nil {
		shared.Fail(http.StatusNotFound, shared.NotFoundMessage("文档"))
	}
}
func InsertCollaboration(db *gorm.DB, id any, state []byte, schema string) {
	ct := dbschema.DocumentCollaboration
	dt := dbschema.Documents
	Must(
		db.Table(ct.Name).
			Create(map[string]any{
				ct.Columns.DOCUMENT_ID:    id,
				ct.Columns.STATE:          state,
				ct.Columns.SCHEMA_VERSION: schema,
				ct.Columns.EPOCH:          1,
				ct.Columns.COLLAB_SEQ:     1,
			}),
	)
	Must(db.Table(dt.Name).Where(dt.Columns.ID+"=?", id).Update(dt.Columns.CONTENT_MODE, "collab"))
}
func CommitCollaboration(db *gorm.DB, id any, state []byte, seq, epoch int64) {
	ct := dbschema.DocumentCollaboration
	result := db.Table(ct.Name).
		Where(ct.Columns.DOCUMENT_ID+
			"=? AND "+
			ct.Columns.COLLAB_SEQ+
			"=? AND "+
			ct.Columns.EPOCH+
			"=?", id, seq, epoch).
		Updates(map[string]any{
			ct.Columns.STATE:      state,
			ct.Columns.COLLAB_SEQ: seq + 1,
			ct.Columns.UPDATED_AT: gorm.Expr(
				"CURRENT_TIMESTAMP(6)",
			),
		})
	Must(result)
	if result.RowsAffected != 1 {
		shared.Fail(http.StatusConflict, shared.MsgCollaborationStateChanged)
	}
}
func CollaborationReceipt(db *gorm.DB, id any, key string) shared.Row {
	ct := dbschema.CollaborationCommits
	return One(
		db.Table(ct.Name).
			Where(ct.Columns.DOCUMENT_ID+"=? AND "+ct.Columns.COMMIT_KEY+"=?", id, key),
	)
}
func RecordCollaborationCommit(db *gorm.DB, id any, key, hash string, seq, revision int64) {
	ct := dbschema.CollaborationCommits
	Must(
		db.Table(ct.Name).
			Create(map[string]any{
				ct.Columns.DOCUMENT_ID:  id,
				ct.Columns.COMMIT_KEY:   key,
				ct.Columns.PAYLOAD_HASH: hash,
				ct.Columns.COLLAB_SEQ:   seq,
				ct.Columns.REVISION:     revision,
			}),
	)
}
func CollaborationEvent(db *gorm.DB, kind, key string) {
	ot := dbschema.CollaborationOutbox
	Must(db.Table(ot.Name).Create(map[string]any{ot.Columns.KIND: kind, ot.Columns.FILE_KEY: key}))
}

func CollaborationMetadata(db *gorm.DB, id any) *CollaborationState {
	ct := dbschema.DocumentCollaboration
	var state CollaborationState
	result := db.Table(ct.Name).
		Select(dbschema.List(
			ct.Columns.DOCUMENT_ID,
			ct.Columns.SCHEMA_VERSION,
			ct.Columns.EPOCH,
			ct.Columns.COLLAB_SEQ,
		)).
		Where(ct.Columns.DOCUMENT_ID+"=?", id).
		Take(&state)
	if result.Error == gorm.ErrRecordNotFound {
		return nil
	}
	Must(result)
	return &state
}

// A controlled whole-document replacement establishes a new collaboration epoch.
// 受控的整篇文档替换会建立新的协同 epoch。
func ReplaceCollaboration(db *gorm.DB, id any, state []byte, seq, epoch int64) {
	ct := dbschema.DocumentCollaboration
	result := db.Table(ct.Name).
		Where(ct.Columns.DOCUMENT_ID+
			"=? AND "+
			ct.Columns.COLLAB_SEQ+
			"=? AND "+
			ct.Columns.EPOCH+
			"=?", id, seq, epoch).
		Updates(map[string]any{
			ct.Columns.STATE:      state,
			ct.Columns.COLLAB_SEQ: seq + 1,
			ct.Columns.EPOCH:      epoch + 1,
			ct.Columns.UPDATED_AT: gorm.Expr(
				"CURRENT_TIMESTAMP(6)",
			),
		})
	Must(result)
	if result.RowsAffected != 1 {
		shared.Fail(http.StatusConflict, shared.MsgCollaborationStateChanged)
	}
}
