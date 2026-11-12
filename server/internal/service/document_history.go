package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"voex-server/internal/config"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

// ConfigureHistory 检查历史版本结构并载入 VOEX_HISTORY_* 配置；未启用时不写快照、不提供接口。
func (s *Service) ConfigureHistory(cfg config.History) error {
	s.historyInterval = cfg.SnapshotInterval
	s.historyMaxVersions = cfg.MaxVersions
	if !cfg.Enabled {
		return nil
	}
	if !s.db.Migrator().HasTable("document_versions") {
		return fmt.Errorf(
			"document history schema missing; apply internal/database/document-history.sql",
		)
	}
	s.historyEnabled = true
	return nil
}

func (s *Service) HistoryEnabled() bool { return s.historyEnabled }

func (s *Service) requireHistory() {
	if !s.historyEnabled {
		shared.Fail(http.StatusNotFound, shared.MsgHistoryDisabled)
	}
}

// historySnapshot 在当前事务内为一份正文记录快照，返回版本 id（未写入时为 0）。
// kind=auto 为被替换正文的采样快照：与最近版本正文相同或未达 VOEX_HISTORY_SNAPSHOT_INTERVAL 时跳过；
// kind=manual 为用户显式命名；kind=backup 为覆盖性操作前的保护快照，总是写入且不参与稀释。
// createdBy/anonymous 保存该正文的作者：自动与保护快照取文档最后修改人，命名版本取操作者。
func (s *Service) historySnapshot(
	db *gorm.DB,
	documentID any,
	content string,
	revision int64,
	createdBy any,
	anonymous bool,
	kind, label string,
) int64 {
	if !s.historyEnabled {
		return 0
	}
	hash := shared.Digest(content)
	latest := repository.LatestDocumentVersion(db, documentID)
	if kind == "auto" && latest != nil {
		if shared.String(latest["content_hash"]) == hash {
			return 0
		}
		if created, ok := latest["created_at"].(time.Time); ok &&
			time.Since(created) < s.historyInterval {
			return 0
		}
	}
	return repository.InsertDocumentVersion(db, shared.Row{
		"document_id": documentID, "revision": revision, "kind": kind, "label": label,
		"content": content, "content_hash": hash, "schema_version": collaborationSchema,
		"created_by": createdBy, "created_by_anonymous": anonymous,
	})
}

func documentVersionDTO(row shared.Row) shared.Row {
	var creator any
	if shared.String(row["created_by"]) != "" {
		creator = shared.Row{
			"id":     row["created_by"],
			"name":   row["created_by_name"],
			"avator": row["created_by_avator"],
		}
	}
	return shared.Row{
		"id": shared.Int64(row["id"]), "revision": shared.Int64(row["revision"]),
		"kind": shared.String(row["kind"]), "label": shared.String(row["label"]),
		"size": shared.Int64(row["size"]), "created_at": shared.Timestamp(row["created_at"]),
		"created_by_anonymous": shared.Bool(row["created_by_anonymous"]), "creator": creator,
	}
}

// ListDocumentVersions 按 id 倒序列出版本元数据；limit 由前端决定，before 为游标版本 id。
func (s *Service) ListDocumentVersions(
	ctx context.Context,
	key string,
	limit, before int64,
) shared.Row {
	s.requireHistory()
	return s.tx(ctx, false, func(db *gorm.DB) any {
		doc := s.FindDocument(db, ctx, key, "read", false)
		rows := repository.DocumentVersions(db, doc["id"], limit, before)
		items := make([]shared.Row, 0, len(rows))
		for _, row := range rows {
			items = append(items, documentVersionDTO(row))
		}
		next := ""
		if int64(len(rows)) == limit {
			next = strconv.FormatInt(shared.Int64(rows[len(rows)-1]["id"]), 10)
		}
		return shared.Row{"items": items, "next_cursor": next}
	}).(shared.Row)
}

// GetDocumentVersion 读取单个版本全文；版本必须属于当前文档。
func (s *Service) GetDocumentVersion(ctx context.Context, key string, versionID int64) shared.Row {
	s.requireHistory()
	return s.tx(ctx, false, func(db *gorm.DB) any {
		doc := s.FindDocument(db, ctx, key, "read", false)
		version := repository.DocumentVersion(db, doc["id"], versionID)
		if version == nil {
			shared.Fail(http.StatusNotFound, shared.NotFoundMessage("版本"))
		}
		result := documentVersionDTO(version)
		result["content"] = shared.String(version["content"])
		return result
	}).(shared.Row)
}

// CreateDocumentVersion 把当前正文保存为命名版本；需要文档写权限。
func (s *Service) CreateDocumentVersion(ctx context.Context, key, label string) shared.Row {
	s.requireHistory()
	return s.tx(ctx, true, func(db *gorm.DB) any {
		doc := s.FindDocument(db, ctx, key, "write", true)
		user := shared.String(identity.User(ctx)["id"])
		id := s.historySnapshot(
			db,
			doc["id"],
			shared.String(doc["file_content"]),
			shared.Int64(doc["revision"]),
			user,
			false,
			"manual",
			strings.TrimSpace(label),
		)
		return documentVersionDTO(repository.DocumentVersion(db, doc["id"], id))
	}).(shared.Row)
}

// DeleteDocumentVersion 删除命名版本；其他类型不可删，重复删除同一版本仍返回成功。
func (s *Service) DeleteDocumentVersion(ctx context.Context, key string, versionID int64) {
	s.requireHistory()
	s.tx(ctx, true, func(db *gorm.DB) any {
		doc := s.FindDocument(db, ctx, key, "write", false)
		version := repository.DocumentVersion(db, doc["id"], versionID)
		if version == nil {
			return nil
		}
		if shared.String(version["kind"]) != "manual" {
			shared.Fail(http.StatusForbidden, shared.MsgHistoryDeleteNamedOnly)
		}
		repository.DeleteDocumentVersion(db, doc["id"], versionID)
		return nil
	})
}

// RestoreDocumentVersion 将文档正文恢复为指定版本；任何有文档编辑权限的人都可以恢复。
// legacy 文档在写事务内直接写入正文；协同文档复用 AI 审阅的整篇替换语义：
// 先经协同进程按目标 Markdown 重建 Yjs 状态（新 CRDT 身份），再在写事务内替换状态
// 并递增 epoch，事务提交后经确认阶段丢弃房间，客户端完整握手重建。
// 恢复前当前内容保存为 backup 版本，恢复本身产出新的 revision。
func (s *Service) RestoreDocumentVersion(
	ctx context.Context,
	key string,
	versionID int64,
) shared.Row {
	s.requireHistory()
	var change shared.Row
	var prepared *collaborationPrepared
	var content, operation string
	var epoch int64
	collab := false
	s.tx(ctx, false, func(db *gorm.DB) any {
		doc := s.FindDocument(db, ctx, key, "write", true)
		version := repository.DocumentVersion(db, doc["id"], versionID)
		if version == nil {
			shared.Fail(http.StatusNotFound, shared.NotFoundMessage("版本"))
		}
		content = shared.String(version["content"])
		if s.collabModeColumn && repository.CollaborationMode(db, key) == "collab" {
			state := repository.CollaborationMetadata(db, doc["id"])
			if state == nil {
				shared.Fail(http.StatusServiceUnavailable, shared.MsgCollaborationStateMissing)
			}
			collab = true
			epoch = state.Epoch
			change = shared.Row{
				"file_key": key, "before_name": doc["file_name"], "after_name": doc["file_name"],
				"before_content": shared.String(doc["file_content"]), "after_content": content,
				"revision": shared.Int64(doc["revision"]),
			}
		}
		return nil
	})
	if collab {
		prepared, operation = s.prepareCollaborationReplace(ctx, key, epoch, change, content)
	}
	committed := false
	defer func() {
		if collab && !committed {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = s.collaborationCall(cleanup, "abort", shared.Row{"operation_id": operation}, nil)
		}
	}()
	result := s.tx(ctx, true, func(db *gorm.DB) any {
		repository.LockCollaborationDocument(db, key)
		doc := s.FindDocument(db, ctx, key, "write", true)
		// 初次读取后可能完成协同初始化；模式变化时重新准备，禁止只覆盖 Markdown。
		currentCollab := s.collabModeColumn && repository.CollaborationMode(db, key) == "collab"
		if currentCollab != collab {
			shared.Fail(http.StatusConflict, shared.MsgHistoryModeChanged)
		}
		version := repository.DocumentVersion(db, doc["id"], versionID)
		if version == nil {
			shared.Fail(http.StatusNotFound, shared.NotFoundMessage("版本"))
		}
		user := shared.String(identity.User(ctx)["id"])
		// 恢复覆盖前先保护当前内容，误恢复可再恢复回去。
		backupID := s.historySnapshot(
			db,
			doc["id"],
			shared.String(doc["file_content"]),
			shared.Int64(doc["revision"]),
			doc["updated_by"],
			shared.Bool(doc["updated_by_anonymous"]),
			"backup",
			"",
		)
		row := shared.Row{
			"success":                true,
			"restored_from":          versionID,
			"pre_restore_version_id": backupID,
		}
		content := shared.String(version["content"])
		if collab {
			if !s.collabSchema {
				shared.Fail(
					http.StatusServiceUnavailable,
					shared.MsgCollaborationDatabaseUnavailable,
				)
			}
			state := repository.CollaborationMetadata(db, doc["id"])
			if state == nil ||
				state.CollabSeq != prepared.ExpectedCollabSeq ||
				state.Epoch != prepared.Epoch ||

				state.SchemaVersion != prepared.SchemaVersion ||
				shared.Int64(doc["revision"]) != prepared.Revision {
				shared.Fail(http.StatusConflict, shared.MsgHistoryCollaborationChanged)
			}
			bytes := collaborationBytes(
				CollaborationRequest{
					SchemaVersion: prepared.SchemaVersion,
					StateBase64:   prepared.StateBase64,
					Markdown:      prepared.Markdown,
				},
			)
			repository.ReplaceCollaboration(db, doc["id"], bytes, state.CollabSeq, state.Epoch)
			repository.CollaborationEvent(db, "document", key)
			content = prepared.Markdown
			row["collab_seq"] = state.CollabSeq + 1
			row["epoch"] = state.Epoch + 1
		}
		repository.WorkspaceUpdateDocument(db, key, shared.Row{"file_content": content}, true, user)
		row["revision"] = shared.Int64(doc["revision"]) + 1
		return row
	}).(shared.Row)
	committed = true
	if collab {
		// 即使确认响应丢失，事务内的 outbox 事件仍会强制房间重载权威状态。
		finalize, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = s.collaborationCall(
			finalize,
			"commit",
			shared.Row{"operation_id": operation, "committed": []shared.Row{result}},
			nil,
		)
	}
	return result
}

// prepareCollaborationReplace 复用 AI 审阅的 prepare/commit 协议重建协同状态；
// 文档已有新修改时返回 409，其余失败语义与审阅应用一致。
func (s *Service) prepareCollaborationReplace(
	ctx context.Context,
	key string,
	epoch int64,
	change shared.Row,
	content string,
) (*collaborationPrepared, string) {
	if s.collab == nil {
		shared.Fail(http.StatusServiceUnavailable, shared.MsgHistoryCollaborationUnavailable)
	}
	operation := shared.UUID()
	authorization := shared.RandomToken(32)
	grant := collaborationGrant{
		Epoch:     epoch,
		FileKey:   key,
		Access:    "workspace",
		UserID:    shared.String(identity.User(ctx)["id"]),
		SessionID: identity.SessionID(ctx),
		Expires:   time.Now().Add(time.Minute),
	}
	s.collab.mu.Lock()
	s.collab.grants["auth:"+authorization] = grant
	s.collab.mu.Unlock()
	change["authorization_id"] = authorization
	var response struct {
		OperationID string                  `json:"operation_id"`
		ExpiresAt   string                  `json:"expires_at"`
		Prepared    []collaborationPrepared `json:"prepared"`
	}
	if err := s.collaborationCall(
		ctx,
		"prepare",
		shared.Row{"operation_id": operation, "changes": []shared.Row{change}},
		&response,
	); err != nil {
		var rejected *collaborationResponseError
		if errors.As(err, &rejected) &&
			(rejected.StatusCode == http.StatusConflict ||
				rejected.StatusCode == http.StatusPreconditionFailed) {
			shared.Fail(http.StatusConflict, shared.MsgHistoryDocumentChanged)
		}
		shared.NetworkFailure("prepare document version restore", err)
	}
	expires, err := time.Parse(time.RFC3339, response.ExpiresAt)
	if err != nil || time.Until(expires) < 5*time.Second {
		shared.Fail(http.StatusServiceUnavailable, shared.MsgCollaborationPreparationExpired)
	}
	if response.OperationID != operation || len(response.Prepared) != 1 ||
		response.Prepared[0].FileKey != key || response.Prepared[0].SourceMarkdown != content {
		shared.Fail(http.StatusServiceUnavailable, shared.MsgHistoryPreparedIncomplete)
	}
	return &response.Prepared[0], operation
}
