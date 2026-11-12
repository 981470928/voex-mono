package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

// AIReviewConflictError 表示文档与已保存的审阅原快照不一致，可由用户确认后强制应用。
type AIReviewConflictError struct{}

func (AIReviewConflictError) Error() string {
	return shared.MsgAIReviewConflict
}

type AIChange struct {
	Kind          string `json:"kind"`
	FileKey       string `json:"file_key"`
	ProjectKey    string `json:"project_key"`
	FolderKey     string `json:"folder_key"`
	BeforeName    string `json:"before_name"`
	AfterName     string `json:"after_name"`
	BeforeContent string `json:"before_content"`
	AfterContent  string `json:"after_content"`
	Revision      int64  `json:"revision"`
}

// ApplyAIReview commits the exact reviewed snapshots in a single transaction.
// Recording the result in that transaction makes retries safe after an unknown network outcome.
// ApplyAIReview 在单个事务中提交已经审阅的原样快照。
// 在同一事务内记录结果，使网络结果未知时的重试仍然安全。
func (s *Service) applyAIReview(
	ctx context.Context,
	id string,
	force bool,
	prepared map[string]collaborationPrepared,
) []shared.Row {
	return s.tx(ctx, true, func(db *gorm.DB) any {
		user := shared.String(identity.User(ctx)["id"])
		if len(prepared) > 0 &&
			repository.AuthUserForSession(
				db,
				user,
				identity.SessionID(ctx),
			) == nil {
			shared.Fail(http.StatusUnauthorized, shared.MsgAIReviewSessionExpired)
		}
		_, snapshot := s.storedAIReview(db, ctx, user, id)
		changes := snapshot.Changes
		encoded, err := json.Marshal(changes)
		shared.Must(err)
		digest := sha256.Sum256(encoded)
		hash := hex.EncodeToString(digest[:])
		if previous := repository.AIApplication(db, user, id); previous != nil {
			if previous["payload_hash"] != hash {
				shared.Fail(http.StatusConflict, shared.MsgAIReviewAlreadyApplied)
			}
			var result []shared.Row
			shared.Must(json.Unmarshal([]byte(shared.String(previous["result_json"])), &result))
			for _, item := range result {
				item["replayed"] = true
			}
			return result
		}
		results := make([]shared.Row, 0, len(changes))
		seen := map[string]bool{}
		for _, change := range changes {
			name := shared.Name(change.AfterName, "文件名称")
			if len(change.AfterContent) > 1024*1024 {
				shared.Fail(http.StatusRequestEntityTooLarge, shared.SizeLimitMessage("单个文档内容"))
			}
			if change.Kind == "create" {
				projectKey := shared.Key(change.ProjectKey, "项目标识")
				folderKey := shared.Key(change.FolderKey, "文件夹标识")
				_, folder := s.workspaceDocumentLocation(db, ctx, projectKey, folderKey, "")
				key := shared.PublicKey()
				repository.WorkspaceInsertDocument(db, key, name, folder["id"], user)
				repository.WorkspaceUpdateDocument(
					db,
					key,
					shared.Row{
						"file_content": change.AfterContent,
					},
					false,
					user,
				)
				// 与手动创建一致：写入基线版本，保证历史时间线有最早可恢复点。
				if created := repository.DocumentByKey(db, key, false); created != nil {
					s.historySnapshot(
						db,
						created["id"],
						change.AfterContent,
						1,
						user,
						false,
						"auto",
						"",
					)
				}
				results = append(
					results,
					shared.Row{
						"file_key":  key,
						"file_name": name,
						"revision":  1,
					},
				)
				continue
			}
			if change.Kind != "update" {
				shared.Fail(http.StatusBadRequest, shared.MsgAIChangeTypeInvalid)
			}
			key := shared.Key(change.FileKey, "文件标识")
			if seen[key] {
				shared.Fail(http.StatusBadRequest, shared.MsgAIChangeDuplicate)
			}
			seen[key] = true
			if s.collabSchema {
				repository.LockCollaborationDocument(db, key)
			}
			row := s.FindDocument(db, ctx, key, "write", true)
			if !force &&
				(shared.Int64(row["revision"]) != change.Revision ||
					shared.String(row["file_name"]) != change.BeforeName ||
					shared.String(row["file_content"]) != change.BeforeContent) {
				panic(AIReviewConflictError{})
			}
			content := change.AfterContent
			result := shared.Row{
				"file_key":  key,
				"file_name": name,
				"revision": shared.Int64(row["revision"]) +
					1,
			}
			if s.collabModeColumn && repository.CollaborationMode(db, key) == "collab" {
				if !s.collabSchema {
					shared.Fail(
						http.StatusServiceUnavailable,
						shared.MsgCollaborationDatabaseUnavailable,
					)
				}
				candidate, ok := prepared[key]
				if !ok {
					shared.Fail(http.StatusConflict, shared.MsgAIReviewCollaborationChanged)
				}
				state := repository.CollaborationMetadata(db, row["id"])
				if state == nil ||
					state.CollabSeq != candidate.ExpectedCollabSeq ||
					state.Epoch != candidate.Epoch ||
					state.SchemaVersion != candidate.SchemaVersion ||
					candidate.Revision != shared.Int64(row["revision"]) {
					shared.Fail(http.StatusConflict, shared.MsgAIReviewPreparedChanged)
				}
				bytes := collaborationBytes(
					CollaborationRequest{
						SchemaVersion: candidate.SchemaVersion,
						StateBase64:   candidate.StateBase64,
						Markdown:      candidate.Markdown,
					},
				)
				repository.ReplaceCollaboration(db, row["id"], bytes, state.CollabSeq, state.Epoch)
				content = candidate.Markdown
				result["collab_seq"] = state.CollabSeq + 1
				result["epoch"] = state.Epoch + 1
				repository.CollaborationEvent(db, "document", key)
			}
			// 整篇替换前保护当前正文；名称修改不动正文时不产生快照。
			if shared.String(row["file_content"]) != content {
				s.historySnapshot(
					db,
					row["id"],
					shared.String(row["file_content"]),
					shared.Int64(row["revision"]),
					row["updated_by"],
					shared.Bool(row["updated_by_anonymous"]),
					"backup",
					"",
				)
			}
			repository.WorkspaceUpdateDocument(
				db,
				key,
				shared.Row{
					"file_name":    name,
					"file_content": content,
				},
				true,
				user,
			)
			results = append(results, result)
		}
		resultJSON, err := json.Marshal(results)
		shared.Must(err)
		repository.RecordAIApplication(db, user, id, hash, string(resultJSON))
		return results
	}).([]shared.Row)
}
