package service

import (
	"context"
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"net/http"
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
// 网络准备必须在开启原有原子 AI 事务之前完成。
// 在工作区锁内再次检查已保存的审阅和每一份文档。
func (s *Service) ApplyAIReview(ctx context.Context, id string, force bool) []shared.Row {
	if !s.collabSchema {
		return s.applyAIReview(ctx, id, force, nil)
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
			if change.Kind == "update" &&
				repository.CollaborationMode(db, change.FileKey) == "collab" {
				doc := s.FindDocument(db, ctx, change.FileKey, "write", true)
				if !force &&
					(shared.Int64(doc["revision"]) != change.Revision ||
						shared.String(doc["file_content"]) != change.BeforeContent ||
						shared.String(doc["file_name"]) != change.BeforeName) {
					panic(AIReviewConflictError{})
				}
				state := repository.CollaborationMetadata(db, doc["id"])
				if state == nil {
					shared.Fail(http.StatusServiceUnavailable, shared.MsgCollaborationStateMissing)
				}
				epochs[change.FileKey] = state.Epoch
				changes = append(changes, change)
			}
		}
		return nil
	})
	if replay || len(changes) == 0 {
		return s.applyAIReview(ctx, id, force, nil)
	}
	if s.collab == nil {
		shared.Fail(http.StatusServiceUnavailable, shared.MsgCollaborationAIUnavailable)
	}
	operation := shared.UUID()
	committed := false
	defer func() {
		if !committed {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := s.collaborationCall(
				cleanup,
				"abort",
				shared.Row{"operation_id": operation},
				nil,
			); err != nil {
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
		grant := collaborationGrant{
			Epoch:     epochs[change.FileKey],
			FileKey:   change.FileKey,
			Access:    "workspace",
			UserID:    shared.String(identity.User(ctx)["id"]),
			SessionID: identity.SessionID(ctx),
			Expires:   time.Now().Add(time.Minute),
		}
		s.collab.mu.Lock()
		s.collab.grants["auth:"+authorization] = grant
		s.collab.mu.Unlock()
		command["authorization_id"] = authorization
		command["force"] = force
		commands = append(commands, command)
	}
	var response struct {
		OperationID string                  `json:"operation_id"`
		ExpiresAt   string                  `json:"expires_at"`
		Prepared    []collaborationPrepared `json:"prepared"`
	}
	if err := s.collaborationCall(
		ctx,
		"prepare",
		shared.Row{"operation_id": operation, "changes": commands},
		&response,
	); err != nil {
		var rejected *collaborationResponseError
		if errors.As(err, &rejected) && rejected.StatusCode == http.StatusPreconditionFailed {
			panic(AIReviewConflictError{})
		}
		if errors.As(err, &rejected) && rejected.StatusCode == http.StatusConflict {
			shared.Fail(http.StatusConflict, shared.MsgCollaborationAIRetry)
		}
		if errors.As(err, &rejected) && rejected.StatusCode == http.StatusRequestEntityTooLarge {
			shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgCollaborationAITooLarge)
		}
		shared.NetworkFailure("prepare collaboration AI review", err)
	}
	if response.OperationID != operation || len(response.Prepared) != len(changes) {
		shared.Fail(http.StatusServiceUnavailable, shared.MsgCollaborationAIPreparedIncomplete)
	}
	expires, err := time.Parse(time.RFC3339, response.ExpiresAt)
	if err != nil || time.Until(expires) < 5*time.Second {
		shared.Fail(http.StatusServiceUnavailable, shared.MsgCollaborationPreparationExpired)
	}
	prepared := map[string]collaborationPrepared{}
	expected := map[string]string{}
	for _, change := range changes {
		expected[change.FileKey] = change.AfterContent
	}
	for _, item := range response.Prepared {
		source, present := expected[item.FileKey]
		if !present || item.SourceMarkdown != source || prepared[item.FileKey].FileKey != "" {
			shared.Fail(http.StatusServiceUnavailable, shared.MsgCollaborationPreparedMismatch)
		}
		prepared[item.FileKey] = item
	}
	commitCtx, cancel := context.WithDeadline(ctx, expires.Add(-2*time.Second))
	defer cancel()
	results := s.applyAIReview(commitCtx, id, force, prepared)
	committed = true
	// Even if the response is lost, the transaction outbox forces an authoritative reload.
	// 即使响应丢失，事务 outbox 仍会强制重新加载权威状态。
	finalize, cancelFinalize := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFinalize()
	_ = s.collaborationCall(
		finalize,
		"commit",
		shared.Row{"operation_id": operation, "committed": results},
		nil,
	)
	return results
}

func (s *Service) scheduleCollaborationReload(changes []AIChange) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// Abort compensation is independent per document; successful reload events
	// must not be rolled back just because another document's enqueue failed.
	// 中止补偿按文档独立执行；不能因为另一份文档的事件入队失败，
	// 就回滚已成功入队的重新加载事件。
	for _, change := range changes {
		if ctx.Err() != nil {
			break
		}
		s.bestEffortWrite(ctx, "collaboration reload event", func(db *gorm.DB) {
			repository.CollaborationEvent(db, "document", change.FileKey)
		})
	}
}
