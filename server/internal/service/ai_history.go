package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

const defaultAISession = "default"

var aiHistoryID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

type AIReviewInput struct {
	ID      string     `json:"id"`
	Changes []AIChange `json:"changes"`
}

type AIFinishTurnInput struct {
	Text     string         `json:"text"`
	Activity []string       `json:"activity"`
	Error    string         `json:"error"`
	Review   *AIReviewInput `json:"review"`
}

func aiMilliseconds(value any) int64 {
	if date, ok := value.(time.Time); ok {
		return date.UnixMilli()
	}
	return 0
}

func aiReviewSummary(row shared.Row) shared.Row {
	status := "pending"
	if shared.String(row["applied_review_id"]) != "" {
		status = "applied"
	}
	return shared.Row{
		"id":        row["review_id"],
		"createdAt": aiMilliseconds(row["completed_at"]),
		"status":    status,
		"fileCount": shared.Int64(row["file_count"]),
	}
}

func aiTurnMessages(row shared.Row) []shared.Row {
	id := shared.String(row["turn_id"])
	var activity []string
	shared.Must(json.Unmarshal([]byte(shared.String(row["activity"])), &activity))
	if activity == nil {
		activity = []string{}
	}
	state := "incomplete"
	if row["completed_at"] != nil {
		state = "complete"
	}
	user := shared.Row{
		"id":          id + ":user",
		"turnId":      id,
		"sequence":    row["id"],
		"role":        "user",
		"text":        row["prompt"],
		"createdAt":   aiMilliseconds(row["created_at"]),
		"attachments": aiAttachmentMetadata(storedAIAttachments(row["attachments"])),
	}
	assistant := shared.Row{
		"id":        id,
		"turnId":    id,
		"sequence":  row["id"],
		"role":      "assistant",
		"text":      row["response"],
		"activity":  activity,
		"error":     row["error"],
		"state":     state,
		"createdAt": aiMilliseconds(row["created_at"]),
	}
	if shared.String(row["review_id"]) != "" {
		assistant["review"] = aiReviewSummary(row)
	}
	return []shared.Row{user, assistant}
}

func (s *Service) AIConversation(
	ctx context.Context,
	fileKey, session string,
	before uint64,
) shared.Row {
	if session != "" && !aiHistoryID.MatchString(session) {
		shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("会话标识"))
	}
	return s.tx(ctx, false, func(db *gorm.DB) any {
		document := s.FindDocument(db, ctx, fileKey, "read", false)
		user := shared.String(identity.User(ctx)["id"])
		if session != "" && repository.AISession(db, user, document["id"], session) == nil {
			shared.Fail(http.StatusNotFound, shared.NotFoundMessage("会话"))
		}
		if session == "" {
			session = defaultAISession
		}
		rows := repository.AIConversation(db, user, document["id"], session, before, 21)
		next := ""
		if len(rows) > 20 {
			rows = rows[:20]
			next = shared.String(rows[len(rows)-1]["id"])
		}
		messages := make([]shared.Row, 0, len(rows)*2)
		for index := len(rows) - 1; index >= 0; index-- {
			messages = append(messages, aiTurnMessages(rows[index])...)
		}
		return shared.Row{"messages": messages, "nextCursor": next}
	}).(shared.Row)
}

func (s *Service) BeginAITurn(
	ctx context.Context,
	fileKey, id, session, model, prompt string,
	attachments []AIAttachment,
) []shared.Row {
	attachments = validateAIAttachments(attachments)
	encodedAttachments := aiAttachmentJSON(attachments)
	if !aiHistoryID.MatchString(id) {
		shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("对话标识"))
	}
	if session != "" && !aiHistoryID.MatchString(session) {
		shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("会话标识"))
	}
	if strings.TrimSpace(prompt) == "" || len(prompt) > 64*1024 {
		shared.Fail(http.StatusBadRequest, shared.MsgAIPromptInvalid)
	}
	return s.tx(ctx, true, func(db *gorm.DB) any {
		user := shared.String(identity.User(ctx)["id"])
		document := s.FindDocument(db, ctx, fileKey, "read", false)
		legacy := session == ""
		if legacy {
			session = defaultAISession
		}
		if row := repository.AITurn(db, user, id); row != nil {
			if row["source_key"] != fileKey ||
				row["session_id"] != session ||
				row["model_id"] != model ||
				row["prompt"] != prompt ||
				aiAttachmentJSON(storedAIAttachments(row["attachments"])) != encodedAttachments {
				shared.Fail(http.StatusConflict, shared.MsgAITurnIDConflict)
			}
			return aiTurnMessages(row)
		}
		modelConfig := repository.AIModel(db, user, model)
		if modelConfig == nil {
			shared.Fail(http.StatusNotFound, shared.NotFoundMessage("模型配置"))
		}
		if len(attachments) > 0 && !shared.Bool(modelConfig["multimodal_enabled"]) {
			shared.Fail(http.StatusBadRequest, shared.MsgAIAttachmentMultimodalRequired)
		}
		if repository.AISession(db, user, document["id"], session) == nil {
			if !legacy {
				shared.Fail(http.StatusNotFound, shared.NotFoundMessage("会话"))
			}
			repository.InsertAISession(db, user, document["id"], session, "新对话")
		}
		title := ""
		if !repository.AISessionHasTurns(db, user, document["id"], session) {
			characters := []rune(strings.Join(strings.Fields(prompt), " "))
			if len(characters) > 40 {
				characters = characters[:40]
			}
			title = string(characters)
		}
		repository.InsertAITurn(
			db,
			user,
			id,
			document["id"],
			session,
			model,
			prompt,
			encodedAttachments,
		)
		repository.TouchAISession(db, user, document["id"], session, title)
		return aiTurnMessages(repository.AITurn(db, user, id))
	}).([]shared.Row)
}

func aiSessionSummary(row shared.Row) shared.Row {
	return shared.Row{
		"id":        row["session_id"],
		"title":     row["title"],
		"createdAt": aiMilliseconds(row["created_at"]),
		"updatedAt": aiMilliseconds(row["updated_at"]),
	}
}

func (s *Service) ListAISessions(ctx context.Context, fileKey string, before uint64) shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		document := s.FindDocument(db, ctx, fileKey, "read", false)
		rows := repository.AISessions(
			db,
			shared.String(identity.User(ctx)["id"]),
			document["id"],
			before,
			21,
		)
		next := ""
		if len(rows) > 20 {
			rows = rows[:20]
			next = shared.String(rows[len(rows)-1]["id"])
		}
		sessions := make([]shared.Row, 0, len(rows))
		for _, row := range rows {
			sessions = append(sessions, aiSessionSummary(row))
		}
		return shared.Row{"sessions": sessions, "nextCursor": next}
	}).(shared.Row)
}

func (s *Service) CreateAISession(ctx context.Context, fileKey, id string) shared.Row {
	if !aiHistoryID.MatchString(id) {
		shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("会话标识"))
	}
	return s.tx(ctx, true, func(db *gorm.DB) any {
		user := shared.String(identity.User(ctx)["id"])
		document := s.FindDocument(db, ctx, fileKey, "read", false)
		if row := repository.AISession(db, user, document["id"], id); row != nil {
			return aiSessionSummary(row)
		}
		repository.InsertAISession(db, user, document["id"], id, "新对话")
		return aiSessionSummary(repository.AISession(db, user, document["id"], id))
	}).(shared.Row)
}

// DeleteAISession shares the workspace write lock with turn writes and review applications.
// DeleteAISession 与对话轮次写入、审阅应用操作共用工作区写锁。
func (s *Service) DeleteAISession(ctx context.Context, fileKey, id string) {
	if !aiHistoryID.MatchString(id) {
		shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("会话标识"))
	}
	s.tx(ctx, true, func(db *gorm.DB) any {
		document := s.FindDocument(db, ctx, fileKey, "read", false)
		user := shared.String(identity.User(ctx)["id"])
		repository.DeleteAISession(db, user, document["id"], id)
		return nil
	})
}

func validateAIReview(review *AIReviewInput, fileKey string) {
	if !aiHistoryID.MatchString(review.ID) || len(review.Changes) == 0 || len(review.Changes) > 20 {
		shared.Fail(http.StatusBadRequest, shared.MsgAIReviewInvalid)
	}
	seen := map[string]bool{}
	for _, change := range review.Changes {
		shared.Name(change.AfterName, "文件名称")
		if len(change.BeforeContent) > 1024*1024 || len(change.AfterContent) > 1024*1024 {
			shared.Fail(http.StatusRequestEntityTooLarge, shared.SizeLimitMessage("单个文档快照"))
		}
		if change.Kind == "update" {
			if change.FileKey != fileKey || change.Revision < 1 || seen[change.FileKey] {
				shared.Fail(http.StatusBadRequest, shared.MsgAIReviewTargetInvalid)
			}
			shared.Name(change.BeforeName, "原文件名称")
		} else if change.Kind == "create" {
			if !strings.HasPrefix(change.FileKey, "draft-") || seen[change.FileKey] {
				shared.Fail(http.StatusBadRequest, shared.MsgAIDraftIDInvalid)
			}
			shared.Key(change.ProjectKey, "项目标识")
			shared.Key(change.FolderKey, "文件夹标识")
		} else {
			shared.Fail(http.StatusBadRequest, shared.MsgAIChangeTypeInvalid)
		}
		seen[change.FileKey] = true
	}
}

func (s *Service) FinishAITurn(
	ctx context.Context,
	fileKey, id string,
	input AIFinishTurnInput,
) []shared.Row {
	if len(input.Text) > 512*1024 || len(input.Error) > 16*1024 || len(input.Activity) > 1100 {
		shared.Fail(http.StatusRequestEntityTooLarge, shared.SizeLimitMessage("对话回复"))
	}
	for _, activity := range input.Activity {
		if len(activity) > 1024 {
			shared.Fail(http.StatusRequestEntityTooLarge, shared.SizeLimitMessage("操作记录"))
		}
	}
	if input.Activity == nil {
		input.Activity = []string{}
	}
	if input.Review != nil {
		validateAIReview(input.Review, fileKey)
	}
	encoded, err := json.Marshal(input)
	shared.Must(err)
	digest := sha256.Sum256(encoded)
	hash := hex.EncodeToString(digest[:])
	return s.tx(ctx, true, func(db *gorm.DB) any {
		user := shared.String(identity.User(ctx)["id"])
		document := s.FindDocument(db, ctx, fileKey, "read", false)
		row := repository.AITurn(db, user, id)
		if row == nil || row["source_key"] != fileKey {
			shared.Fail(http.StatusNotFound, shared.NotFoundMessage("对话"))
		}
		if row["completed_at"] != nil {
			if row["finish_hash"] != hash {
				shared.Fail(http.StatusConflict, shared.MsgAIResponseAlreadySaved)
			}
			return aiTurnMessages(row)
		}
		activity, err := json.Marshal(input.Activity)
		shared.Must(err)
		values := shared.Row{
			"response":    input.Text,
			"activity":    string(activity),
			"error":       input.Error,
			"finish_hash": hash,
		}
		if input.Review != nil {
			if repository.AIStoredReview(db, user, input.Review.ID) != nil {
				shared.Fail(http.StatusConflict, shared.MsgAIReviewResponseConflict)
			}
			// Older releases may have an application record without a saved conversation.
			// Reusing that ID must never label different snapshot content as already applied.
			// 旧版本可能存在审阅应用记录，却没有保存对应对话。
			// 复用该 ID 时，绝不能把不同的快照内容标记为已应用。
			if applied := repository.AIApplication(db, user, input.Review.ID); applied != nil {
				changes, err := json.Marshal(input.Review.Changes)
				shared.Must(err)
				digest := sha256.Sum256(changes)
				if shared.String(applied["payload_hash"]) != hex.EncodeToString(digest[:]) {
					shared.Fail(http.StatusConflict, shared.MsgAIReviewAppliedConflict)
				}
			}
			for _, change := range input.Review.Changes {
				if change.ProjectKey != shared.String(document["project_key"]) ||
					change.FolderKey != shared.String(document["folder_key"]) {
					shared.Fail(http.StatusBadRequest, shared.MsgAIReviewFolderMismatch)
				}
			}
			snapshot, err := json.Marshal(input.Review)
			shared.Must(err)
			values["review_id"] = input.Review.ID
			values["review_json"] = string(snapshot)
		}
		repository.FinishAITurn(db, user, id, values)
		repository.TouchAISession(db, user, document["id"], shared.String(row["session_id"]), "")
		return aiTurnMessages(repository.AITurn(db, user, id))
	}).([]shared.Row)
}

func (s *Service) storedAIReview(
	db *gorm.DB,
	ctx context.Context,
	user, id string,
) (shared.Row, AIReviewInput) {
	row := repository.AIStoredReview(db, user, id)
	if row == nil {
		shared.Fail(http.StatusNotFound, shared.MsgAIReviewSnapshotMissing)
	}
	s.FindDocument(db, ctx, shared.String(row["source_key"]), "read", false)
	var snapshot AIReviewInput
	shared.Must(json.Unmarshal([]byte(shared.String(row["review_json"])), &snapshot))
	return row, snapshot
}

func (s *Service) GetAIReview(ctx context.Context, id string) shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		row, snapshot := s.storedAIReview(db, ctx, shared.String(identity.User(ctx)["id"]), id)
		result := aiReviewSummary(row)
		result["changes"] = snapshot.Changes
		return result
	}).(shared.Row)
}
