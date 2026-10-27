package service

import (
	"context"
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"log"
	"time"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"
)

type collaborationPrepared struct {
	FileKey           string `json:"file_key"`
	StateBase64       string `json:"state_base64"`
	ExpectedCollabSeq int64  `json:"expected_collab_seq"`
	Epoch             int64  `json:"epoch"`
	SchemaVersion     string `json:"schema_version"`
	Revision          int64  `json:"revision"`
	Markdown          string `json:"markdown"`
	SourceMarkdown    string `json:"source_markdown"`
}

// Network preparation must happen before opening the original atomic AI transaction.
// The stored review and every document are checked again under the workspace lock.
func (s *Service) ApplyAIReview(ctx context.Context, id string) []shared.Row {
	if !s.collabSchema {
		return s.applyAIReview(ctx, id, nil)
	}
	changes := []AIChange{}
	epochs := map[string]int64{}
	replay := false
	s.tx(ctx, false, func(db *gorm.DB) any {
		user := shared.String(identity.User(ctx)["id"])
		_, review := s.storedAIReview(db, ctx, user, id)
		if repository.AIApplication(db, user, id) != nil {
			replay = true
			return nil
		}
		for _, change := range review.Changes {
			if change.Kind == "update" && repository.CollaborationMode(db, change.FileKey) == "collab" {
				doc := s.FindDocument(db, ctx, change.FileKey, "write", true)
				if shared.Int64(doc["revision"]) != change.Revision || shared.String(doc["file_content"]) != change.BeforeContent || shared.String(doc["file_name"]) != change.BeforeName {
					shared.Fail(409, "文件已发生变化，请重新生成建议；本次修改未应用")
				}
				state := repository.CollaborationMetadata(db, doc["id"])
				if state == nil {
					shared.Fail(503, "协同文档状态缺失")
				}
				epochs[change.FileKey] = state.Epoch
				changes = append(changes, change)
			}
		}
		return nil
	})
	if replay || len(changes) == 0 {
		return s.applyAIReview(ctx, id, nil)
	}
	if s.collab == nil {
		shared.Fail(503, "协同服务未启用，无法应用协同文档审阅")
	}
	operation := shared.UUID()
	committed := false
	defer func() {
		if !committed {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := s.collaborationCall(cleanup, "abort", shared.Row{"operation_id": operation}, nil); err != nil {
				s.scheduleCollaborationReload(changes)
			}
		}
	}()
	commands := make([]shared.Row, 0, len(changes))
	for _, change := range changes {
		raw, err := json.Marshal(change)
		shared.Must(err)
		var command shared.Row
		shared.Must(json.Unmarshal(raw, &command))
		authorization := shared.RandomToken(32)
		grant := collaborationGrant{Epoch: epochs[change.FileKey], FileKey: change.FileKey, Access: "workspace", UserID: shared.String(identity.User(ctx)["id"]), SessionID: identity.SessionID(ctx), Expires: time.Now().Add(time.Minute)}
		s.collab.mu.Lock()
		s.collab.grants["auth:"+authorization] = grant
		s.collab.mu.Unlock()
		command["authorization_id"] = authorization
		commands = append(commands, command)
	}
	var response struct {
		OperationID string                  `json:"operation_id"`
		ExpiresAt   string                  `json:"expires_at"`
		Prepared    []collaborationPrepared `json:"prepared"`
	}
	if err := s.collaborationCall(ctx, "prepare", shared.Row{"operation_id": operation, "changes": commands}, &response); err != nil {
		var rejected *collaborationResponseError
		if errors.As(err, &rejected) && rejected.StatusCode == 409 {
			shared.Fail(409, "文件已有新的协同修改，请重新生成建议；本次修改未应用")
		}
		if errors.As(err, &rejected) && rejected.StatusCode == 413 {
			shared.Fail(413, "协同文档超过大小限制；本次修改未应用")
		}
		shared.Fail(503, "协同服务暂不可用，审阅尚未应用")
	}
	if response.OperationID != operation || len(response.Prepared) != len(changes) {
		shared.Fail(503, "协同准备结果不完整，审阅尚未应用")
	}
	expires, err := time.Parse(time.RFC3339, response.ExpiresAt)
	if err != nil || time.Until(expires) < 5*time.Second {
		shared.Fail(503, "协同准备已过期，请重试")
	}
	prepared := map[string]collaborationPrepared{}
	expected := map[string]string{}
	for _, change := range changes {
		expected[change.FileKey] = change.AfterContent
	}
	for _, item := range response.Prepared {
		source, present := expected[item.FileKey]
		if !present || item.SourceMarkdown != source || prepared[item.FileKey].FileKey != "" {
			shared.Fail(503, "协同准备文件不匹配")
		}
		prepared[item.FileKey] = item
	}
	commitCtx, cancel := context.WithDeadline(ctx, expires.Add(-2*time.Second))
	defer cancel()
	results := s.applyAIReview(commitCtx, id, prepared)
	committed = true
	// Even if the response is lost, the transaction outbox forces an authoritative reload.
	finalize, cancelFinalize := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFinalize()
	_ = s.collaborationCall(finalize, "commit", shared.Row{"operation_id": operation, "committed": results}, nil)
	return results
}

func (s *Service) scheduleCollaborationReload(changes []AIChange) {
	defer func() {
		if v := recover(); v != nil {
			log.Printf("[Collaboration] reload event failed (%T)", v)
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s.tx(ctx, true, func(db *gorm.DB) any {
		for _, change := range changes {
			repository.CollaborationEvent(db, "document", change.FileKey)
		}
		return nil
	})
}
