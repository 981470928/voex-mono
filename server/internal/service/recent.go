package service

import (
	"context"
	"gorm.io/gorm"
	"log"
	"net/http"
	"time"
	"voex-server/internal/filestore"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"
)

// File edit grants remain valid independently of recent-history retention.
// 文件编辑授权独立于最近访问记录的保留策略，持续保持有效。
func (s *Service) recentPermissions(
	db *gorm.DB,
	ctx context.Context,
	doc, project shared.Row,
) (shared.Row, string) {
	permissions := s.documentPermissions(db, ctx, doc, project)
	if shared.Bool(project["read"]) {
		return permissions, "project"
	}
	access := "unavailable"
	if shared.Bool(permissions["read"]) {
		access = "share"
	}
	return permissions, access
}

func (s *Service) ListRecentFiles(ctx context.Context, limit int) (shared.Row, bool) {
	needsCleanup := false
	result := s.tx(ctx, false, func(db *gorm.DB) any {
		userID := shared.String(identity.User(ctx)["id"])
		queryLimit := limit
		// Avoid overflowing a valid int into a negative (unbounded) GORM limit.
		// 避免有效 int 溢出为负数，导致 GORM limit 变为不受限。
		if queryLimit < int(^uint(0)>>1) {
			queryLimit++
		}
		rows := repository.RecentFiles(db, userID, queryLimit)
		needsCleanup = len(rows) > limit
		if needsCleanup {
			rows = rows[:limit]
		}
		items := make([]shared.Row, 0, len(rows))
		projects := map[string]shared.Row{}
		for _, doc := range rows {
			projectKey := shared.String(doc["project_key"])
			project, ok := projects[projectKey]
			if !ok {
				project = s.ProjectPermissions(db, ctx, projectKey)
				projects[projectKey] = project
			}
			permissions, access := s.recentPermissions(db, ctx, doc, project)
			// No parent metadata or current file metadata is disclosed after access is lost.
			// 失去访问权限后，不再披露父级元数据或当前文件元数据。
			item := shared.Row{
				"file_key":    doc["file_key"],
				"file_name":   doc["viewed_name"],
				"access":      access,
				"permissions": permissions,
				"path":        nil,
			}
			if shared.Bool(permissions["read"]) {
				item = documentDetailsDTO(doc, permissions, access)
			}
			item["viewed_at"] = shared.Timestamp(doc["viewed_at"])
			items = append(items, item)
		}
		return shared.Row{"items": items, "total": len(items), "limit": limit}
	}).(shared.Row)
	return result, needsCleanup
}

// Called only after the list response has been written. Do not retain the HTTP
// request context: it is canceled when the handler returns.
// 仅在列表响应写出后调用；不保留 HTTP 请求上下文，
// 因为 handler 返回时该上下文会被取消。
func (s *Service) ScheduleRecentCleanup(userID string, limit int) {
	// Requests with different limits must retain their own cleanup policy.
	// 使用不同 limit 的请求必须各自保留对应的清理策略。
	key := struct {
		userID string
		limit  int
	}{userID, limit}
	if _, running := s.recentCleanups.LoadOrStore(key, struct{}{}); running {
		return
	}
	go func() {
		defer s.recentCleanups.Delete(key)
		defer func() {
			if failure := recover(); failure != nil {
				// A cleanup failure must not crash the process or affect a sent response.
				// The next overflowing list request will schedule another attempt.
				// 清理失败不得导致进程崩溃，也不得影响已发出的响应。
				// 下次列表请求发现记录超限时，会安排再次清理。
				log.Printf("[RecentFiles] cleanup failed (%T)", failure)
			}
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		repository.PruneRecentFiles(s.db.WithContext(ctx), userID, limit)
	}()
}

func (s *Service) findRecentFile(
	db *gorm.DB,
	ctx context.Context,
	key, action string,
	content bool,
) (shared.Row, shared.Row, string) {
	userID := shared.String(identity.User(ctx)["id"])
	doc := repository.RecentFileByKey(db, userID, key, content)
	if doc == nil {
		shared.Fail(http.StatusNotFound, shared.MsgRecentFileNotFound)
	}
	permissions, access := s.recentPermissions(
		db,
		ctx,
		doc,
		s.ProjectPermissions(db, ctx, shared.String(doc["project_key"])),
	)
	if !shared.Bool(permissions[action]) {
		shared.Fail(http.StatusForbidden, shared.MsgFilePermissionChanged)
	}
	return doc, permissions, access
}

func (s *Service) recordRecentFile(ctx context.Context, doc shared.Row) {
	userID := shared.String(identity.User(ctx)["id"])
	s.bestEffortWrite(ctx, "record recent file", func(db *gorm.DB) {
		repository.RecordRecentFile(db, userID, doc)
	})
}

func (s *Service) GetRecentFile(ctx context.Context, key string, recordVisit bool) shared.Row {
	var doc shared.Row
	result := s.tx(ctx, false, func(db *gorm.DB) any {
		var permissions shared.Row
		doc, permissions, _ = s.findRecentFile(db, ctx, key, "read", true)
		return s.addCollaborationMetadata(db, key, limitedDocumentDTO(db, doc, permissions, ""))
	}).(shared.Row)
	if recordVisit {
		s.recordRecentFile(ctx, doc)
	}
	return result
}

func (s *Service) RecentAttachment(ctx context.Context, key, hash string) filestore.Download {
	if !attachmentHashPattern.MatchString(hash) {
		shared.Fail(http.StatusNotFound, shared.NotFoundMessage("附件"))
	}
	file := s.tx(ctx, false, func(db *gorm.DB) any {
		doc, _, _ := s.findRecentFile(db, ctx, key, "read", false)
		file := repository.AttachmentByHash(db, shared.String(doc["file_key"]), hash)
		if file == nil {
			shared.Fail(http.StatusNotFound, shared.NotFoundMessage("附件"))
		}
		return file
	}).(shared.Row)
	return filestore.Download{
		Key:     s.Files.AttachmentKey(hash),
		Name:    shared.String(file["name"]),
		MIME:    "application/octet-stream",
		Cache:   "no-store",
		Missing: shared.NotFoundMessage("文件"),
	}
}

func (s *Service) RemoveRecentFile(ctx context.Context, key string) {
	repository.RemoveRecentFile(s.db.WithContext(ctx), shared.String(identity.User(ctx)["id"]), key)
}
