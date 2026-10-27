package repository

import (
	"context"
	"database/sql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"voex-server/internal/shared"
)

// Binary state must never pass through Rows, which intentionally converts []byte to text.
type CollaborationState struct {
	DocumentID    int64  `gorm:"column:document_id"`
	State         []byte `gorm:"column:state"`
	SchemaVersion string `gorm:"column:schema_version"`
	Epoch         int64  `gorm:"column:epoch"`
	CollabSeq     int64  `gorm:"column:collab_seq"`
}

func LoadCollaboration(db *gorm.DB, id any) *CollaborationState {
	var state CollaborationState
	result := db.Table("document_collaboration").Where("document_id=?", id).Take(&state)
	if result.Error == gorm.ErrRecordNotFound {
		return nil
	}
	Must(result)
	return &state
}
func CollaborationMode(db *gorm.DB, key string) string {
	row := One(db.Table("documents").Select("content_mode").Where("file_key=?", key))
	return shared.String(row["content_mode"])
}

// SHARE locks permit concurrent document commits. ACL/legacy writers take UPDATE
// on the same row first, then document locks: one consistent lock order.
func CollaborationTransaction(ctx context.Context, db *gorm.DB, key string, fn func(*gorm.DB) any) any {
	var result any
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if One(tx.Table("workspace_state").Where("id=1").Clauses(clause.Locking{Strength: "SHARE"})) == nil {
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
	if One(db.Table("documents").Select("id").Where("file_key=? AND deleted_at IS NULL", key).Clauses(clause.Locking{Strength: "UPDATE"})) == nil {
		shared.Fail(404, "文档不存在")
	}
}
func InsertCollaboration(db *gorm.DB, id any, state []byte, schema string) {
	Must(db.Table("document_collaboration").Create(map[string]any{"document_id": id, "state": state, "schema_version": schema, "epoch": 1, "collab_seq": 1}))
	Must(db.Table("documents").Where("id=?", id).Update("content_mode", "collab"))
}
func CommitCollaboration(db *gorm.DB, id any, state []byte, seq, epoch int64) {
	result := db.Table("document_collaboration").Where("document_id=? AND collab_seq=? AND epoch=?", id, seq, epoch).Updates(map[string]any{"state": state, "collab_seq": seq + 1, "updated_at": gorm.Expr("CURRENT_TIMESTAMP(6)")})
	Must(result)
	if result.RowsAffected != 1 {
		shared.Fail(409, "协同状态已更新，请重新加载")
	}
}
func CollaborationReceipt(db *gorm.DB, id any, key string) shared.Row {
	return One(db.Table("collaboration_commits").Where("document_id=? AND commit_key=?", id, key))
}
func RecordCollaborationCommit(db *gorm.DB, id any, key, hash string, seq, revision int64) {
	Must(db.Table("collaboration_commits").Create(map[string]any{"document_id": id, "commit_key": key, "payload_hash": hash, "collab_seq": seq, "revision": revision}))
}
func CollaborationEvent(db *gorm.DB, kind, key string) {
	Must(db.Table("collaboration_outbox").Create(map[string]any{"kind": kind, "file_key": key}))
}

func CollaborationMetadata(db *gorm.DB, id any) *CollaborationState {
	var state CollaborationState
	result := db.Table("document_collaboration").Select("document_id,schema_version,epoch,collab_seq").Where("document_id=?", id).Take(&state)
	if result.Error == gorm.ErrRecordNotFound {
		return nil
	}
	Must(result)
	return &state
}

// A controlled whole-document replacement establishes a new collaboration epoch.
func ReplaceCollaboration(db *gorm.DB, id any, state []byte, seq, epoch int64) {
	result := db.Table("document_collaboration").Where("document_id=? AND collab_seq=? AND epoch=?", id, seq, epoch).Updates(map[string]any{"state": state, "collab_seq": seq + 1, "epoch": epoch + 1, "updated_at": gorm.Expr("CURRENT_TIMESTAMP(6)")})
	Must(result)
	if result.RowsAffected != 1 {
		shared.Fail(409, "协同状态已更新，请重新加载")
	}
}
