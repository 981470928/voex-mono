package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

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
func (s *Service) applyAIReview(ctx context.Context, id string, prepared map[string]collaborationPrepared) []shared.Row {
	return s.tx(ctx, true, func(db *gorm.DB) any {
		user := shared.String(identity.User(ctx)["id"])
		if len(prepared) > 0 && repository.AuthUserForSession(db, user, identity.SessionID(ctx)) == nil {
			shared.Fail(401, "登录已失效，审阅未应用")
		}
		_, snapshot := s.storedAIReview(db, ctx, user, id)
		changes := snapshot.Changes
		encoded, err := json.Marshal(changes)
		shared.Must(err)
		digest := sha256.Sum256(encoded)
		hash := hex.EncodeToString(digest[:])
		if previous := repository.AIApplication(db, user, id); previous != nil {
			if previous["payload_hash"] != hash {
				shared.Fail(409, "此审阅标识已应用另一份修改")
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
				shared.Fail(413, "单个文档内容超过大小限制")
			}
			if change.Kind == "create" {
				projectKey := shared.Key(change.ProjectKey, "项目标识")
				folderKey := shared.Key(change.FolderKey, "文件夹标识")
				_, folder := s.workspaceDocumentLocation(db, ctx, projectKey, folderKey, "")
				key := shared.PublicKey()
				repository.WorkspaceInsertDocument(db, key, name, folder["id"], user)
				repository.WorkspaceUpdateDocument(db, key, shared.Row{"file_content": change.AfterContent}, false, user)
				results = append(results, shared.Row{"file_key": key, "file_name": name, "revision": 1})
				continue
			}
			if change.Kind != "update" {
				shared.Fail(400, "不支持的文件修改类型")
			}
			key := shared.Key(change.FileKey, "文件标识")
			if seen[key] {
				shared.Fail(400, "同一文件的修改需要合并为一个快照")
			}
			seen[key] = true
			row := s.FindDocument(db, ctx, key, "write", true)
			if s.collabSchema {
				repository.LockCollaborationDocument(db, key)
			}
			if shared.Int64(row["revision"]) != change.Revision || shared.String(row["file_name"]) != change.BeforeName || shared.String(row["file_content"]) != change.BeforeContent {
				shared.Fail(409, "文件已发生变化，请基于最新文档重新生成建议；本次修改未应用")
			}
			content := change.AfterContent
			result := shared.Row{"file_key": key, "file_name": name, "revision": change.Revision + 1}
			if s.collabModeColumn && repository.CollaborationMode(db, key) == "collab" {
				if !s.collabSchema {
					shared.Fail(503, "协同数据库尚未就绪，禁止覆盖正文")
				}
				candidate, ok := prepared[key]
				if !ok {
					shared.Fail(409, "协同文档状态已变化，请重新应用审阅")
				}
				state := repository.CollaborationMetadata(db, row["id"])
				if state == nil || state.CollabSeq != candidate.ExpectedCollabSeq || state.Epoch != candidate.Epoch || state.SchemaVersion != candidate.SchemaVersion || candidate.Revision != change.Revision {
					shared.Fail(409, "协同文档已变化，请重新生成审阅")
				}
				bytes := collaborationBytes(CollaborationRequest{SchemaVersion: candidate.SchemaVersion, StateBase64: candidate.StateBase64, Markdown: candidate.Markdown})
				repository.ReplaceCollaboration(db, row["id"], bytes, state.CollabSeq, state.Epoch)
				content = candidate.Markdown
				result["collab_seq"] = state.CollabSeq + 1
				result["epoch"] = state.Epoch + 1
				repository.CollaborationEvent(db, "document", key)
			}
			repository.WorkspaceUpdateDocument(db, key, shared.Row{"file_name": name, "file_content": content}, true, user)
			results = append(results, result)
		}
		resultJSON, err := json.Marshal(results)
		shared.Must(err)
		repository.RecordAIApplication(db, user, id, hash, string(resultJSON))
		return results
	}).([]shared.Row)
}
