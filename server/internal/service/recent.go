package service

import (
	"context"
	"gorm.io/gorm"
	"log"
	"time"
	"voex-server/internal/filestore"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"
)

// File edit grants remain valid independently of recent-history retention.
func (s *Service) recentPermissions(db *gorm.DB, ctx context.Context, doc, project shared.Row) (shared.Row, string) {
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
			item := shared.Row{
				"file_key": doc["file_key"], "file_name": doc["viewed_name"],
				"access": access, "permissions": permissions, "path": nil,
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
func (s *Service) ScheduleRecentCleanup(userID string, limit int) {
	// Requests with different limits must retain their own cleanup policy.
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
				log.Printf("[RecentFiles] cleanup failed (%T)", failure)
			}
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		s.tx(ctx, true, func(db *gorm.DB) any {
			repository.PruneRecentFiles(db, userID, limit)
			return nil
		})
	}()
}

func (s *Service) findRecentFile(db *gorm.DB, ctx context.Context, key, action string, content bool) (shared.Row, shared.Row, string) {
	userID := shared.String(identity.User(ctx)["id"])
	doc := repository.RecentFileByKey(db, userID, key, content)
	if doc == nil {
		shared.Fail(404, "最近查看记录不存在，请从原文件或分享链接重新打开")
	}
	permissions, access := s.recentPermissions(db, ctx, doc, s.ProjectPermissions(db, ctx, shared.String(doc["project_key"])))
	if !shared.Bool(permissions[action]) {
		shared.Fail(403, "文件访问权限已变更或分享已撤销")
	}
	return doc, permissions, access
}

func (s *Service) GetRecentFile(ctx context.Context, key string, recordVisit bool) shared.Row {
	return s.tx(ctx, recordVisit, func(db *gorm.DB) any {
		doc, permissions, _ := s.findRecentFile(db, ctx, key, "read", true)
		if recordVisit {
			repository.RecordRecentFile(db, shared.String(identity.User(ctx)["id"]), doc)
		}
		return s.addCollaborationMetadata(db, key, limitedDocumentDTO(db, doc, permissions, ""))
	}).(shared.Row)
}

func (s *Service) RecentAttachment(ctx context.Context, key, hash string) filestore.Download {
	if !attachmentHashPattern.MatchString(hash) {
		shared.Fail(404, "附件不存在")
	}
	file := s.tx(ctx, false, func(db *gorm.DB) any {
		doc, _, _ := s.findRecentFile(db, ctx, key, "read", false)
		file := repository.AttachmentByHash(db, shared.String(doc["file_key"]), hash)
		if file == nil {
			shared.Fail(404, "附件不存在")
		}
		return file
	}).(shared.Row)
	return filestore.Download{Key: s.Files.AttachmentKey(hash), Name: shared.String(file["name"]), MIME: "application/octet-stream", Cache: "no-store", Missing: "文件不存在"}
}

func (s *Service) RemoveRecentFile(ctx context.Context, key string) {
	s.tx(ctx, true, func(db *gorm.DB) any {
		repository.RemoveRecentFile(db, shared.String(identity.User(ctx)["id"]), key)
		return nil
	})
}
