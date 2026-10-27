package service

import (
	"context"
	"encoding/base64"
	"gorm.io/gorm"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"
)

type CollaborationRequest struct {
	Ticket            string   `json:"ticket"`
	AuthorizationID   string   `json:"authorization_id"`
	FileKey           string   `json:"file_key"`
	Actors            []string `json:"actors"`
	ExpectedRevision  int64    `json:"expected_revision"`
	ExpectedCollabSeq int64    `json:"expected_collab_seq"`
	Epoch             int64    `json:"epoch"`
	SchemaVersion     string   `json:"schema_version"`
	StateBase64       string   `json:"state_base64"`
	SourceMarkdown    string   `json:"source_markdown"`
	Markdown          string   `json:"markdown"`
	IdempotencyKey    string   `json:"idempotency_key"`
}

func collaborationBytes(input CollaborationRequest) []byte {
	if input.SchemaVersion != collaborationSchema {
		shared.Fail(409, "协同文档格式版本不兼容")
	}
	if len(input.Markdown) > 2<<20 || len(input.StateBase64) > 24<<20 {
		shared.Fail(413, "协同文档超过大小限制")
	}
	state, err := base64.StdEncoding.DecodeString(input.StateBase64)
	if err != nil || len(state) == 0 || len(state) > 16<<20 {
		shared.Fail(400, "协同状态格式无效")
	}
	return state
}
func collaborationSnapshot(db *gorm.DB, doc shared.Row) shared.Row {
	result := shared.Row{"file_key": doc["file_key"], "document_name": doc["file_key"], "file_name": doc["file_name"], "markdown": shared.String(doc["file_content"]), "revision": shared.Int64(doc["revision"]), "content_mode": "legacy", "collab_seq": int64(0), "epoch": int64(1), "schema_version": collaborationSchema, "state_base64": ""}
	if state := repository.LoadCollaboration(db, doc["id"]); state != nil {
		result["content_mode"] = "collab"
		result["state_base64"] = base64.StdEncoding.EncodeToString(state.State)
		result["collab_seq"] = state.CollabSeq
		result["epoch"] = state.Epoch
		result["schema_version"] = state.SchemaVersion
	}
	return result
}
func (s *Service) LoadCollaboration(ctx context.Context, input CollaborationRequest) shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		doc, _, _ := s.authorizeGrant(db, ctx, input.AuthorizationID, input.FileKey, false, true)
		return collaborationSnapshot(db, doc)
	}).(shared.Row)
}
func (s *Service) InitializeCollaboration(ctx context.Context, input CollaborationRequest) shared.Row {
	state := collaborationBytes(input)
	if input.ExpectedRevision < 1 || len(input.SourceMarkdown) > 2<<20 {
		shared.Fail(400, "协同初始化版本无效")
	}
	return repository.CollaborationTransaction(ctx, s.db, input.FileKey, func(db *gorm.DB) any {
		doc, _, _ := s.authorizeGrant(db, ctx, input.AuthorizationID, input.FileKey, false, true)
		if current := repository.CollaborationMetadata(db, doc["id"]); current != nil {
			return collaborationSnapshot(db, doc)
		}
		if shared.Int64(doc["revision"]) != input.ExpectedRevision || shared.String(doc["file_content"]) != input.SourceMarkdown {
			shared.Fail(409, "文件已更新，请重新加载后初始化协同")
		}
		repository.InsertCollaboration(db, doc["id"], state, input.SchemaVersion)
		// Normalization is server-side representation initialization, not an anonymous edit.
		if input.Markdown != input.SourceMarkdown {
			repository.Must(db.Table("documents").Where("id=?", doc["id"]).Updates(map[string]any{"file_content": input.Markdown, "revision": gorm.Expr("revision+1")}))
			doc["revision"] = input.ExpectedRevision + 1
			doc["file_content"] = input.Markdown
		}
		return collaborationSnapshot(db, doc)
	}).(shared.Row)
}
func (s *Service) CommitCollaboration(ctx context.Context, input CollaborationRequest) shared.Row {
	state := collaborationBytes(input)
	if input.ExpectedCollabSeq < 1 || input.Epoch < 1 || input.IdempotencyKey == "" || len(input.IdempotencyKey) > 128 || len(input.Actors) > 1000 {
		shared.Fail(400, "协同提交标识无效")
	}
	hash := collaborationHash(shared.Row{"state": input.StateBase64, "markdown": input.Markdown, "seq": input.ExpectedCollabSeq, "epoch": input.Epoch, "schema": input.SchemaVersion})
	return repository.CollaborationTransaction(ctx, s.db, input.FileKey, func(db *gorm.DB) any {
		// A committed receipt is an acknowledgment, not a new write. The internal
		// service credential and matching payload digest make retries safe even
		// when the original user's authorization expired after a successful commit.
		doc := repository.DocumentByKey(db, input.FileKey, false)
		if doc == nil {
			shared.Fail(404, "文档不存在")
		}
		if previous := repository.CollaborationReceipt(db, doc["id"], input.IdempotencyKey); previous != nil {
			if shared.String(previous["payload_hash"]) != hash {
				shared.Fail(409, "协同提交标识已用于另一份修改")
			}
			return shared.Row{"file_key": input.FileKey, "collab_seq": shared.Int64(previous["collab_seq"]), "revision": shared.Int64(previous["revision"]), "epoch": input.Epoch, "replayed": true}
		}
		doc, _, principal := s.authorizeGrant(db, ctx, input.AuthorizationID, input.FileKey, true, false)
		if s.collaborationGrant(input.AuthorizationID).Epoch != input.Epoch {
			shared.Fail(409, "协同授权属于旧文档版本")
		}
		for _, actor := range input.Actors {
			s.authorizeGrant(db, ctx, actor, input.FileKey, true, false)
			if s.collaborationGrant(actor).Epoch != input.Epoch {
				shared.Fail(409, "协同更新属于旧文档版本")
			}
		}
		current := repository.CollaborationMetadata(db, doc["id"])
		if current == nil || current.Epoch != input.Epoch || current.CollabSeq != input.ExpectedCollabSeq || current.SchemaVersion != input.SchemaVersion {
			shared.Fail(409, "协同状态已更新，请重新加载")
		}
		repository.CommitCollaboration(db, doc["id"], state, current.CollabSeq, current.Epoch)
		repository.WorkspaceUpdateDocument(db, input.FileKey, shared.Row{"file_content": input.Markdown}, true, shared.String(identity.User(principal)["id"]))
		revision := shared.Int64(doc["revision"]) + 1
		repository.RecordCollaborationCommit(db, doc["id"], input.IdempotencyKey, hash, current.CollabSeq+1, revision)
		return shared.Row{"file_key": input.FileKey, "collab_seq": current.CollabSeq + 1, "revision": revision, "epoch": current.Epoch}
	}).(shared.Row)
}
