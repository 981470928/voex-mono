package service

import (
	"context"
	"fmt"
	"log"
	"time"
	"voex-server/internal/repository"

	"gorm.io/gorm"
)

// cleanupTrashItem 在独立写事务中清理一个对象。
func (s *Service) cleanupTrashItem(
	ctx context.Context,
	id int64,
	purge func(*gorm.DB, int64) bool,
) (deleted bool, err error) {
	defer func() {
		if failure := recover(); failure != nil {
			deleted = false
			err = fmt.Errorf("trash cleanup failed (%T)", failure)
		}
	}()

	itemCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	deleted = s.tx(itemCtx, true, func(db *gorm.DB) any {
		removed := purge(db, id)
		if removed && s.collabSchema {
			repository.CollaborationEvent(db, "deleted", "")
		}
		return removed
	}).(bool)

	return deleted, nil
}

// cleanupTrashType 分批清理一种对象，单项失败后继续处理其他对象。
func (s *Service) cleanupTrashType(
	ctx context.Context,
	itemType string,
	scan func(*gorm.DB, int64) []int64,
	purge func(*gorm.DB, int64) bool,
) {
	started := time.Now()
	deletedCount, failedCount := 0, 0
	var afterID int64

	defer func() {
		if failure := recover(); failure != nil && ctx.Err() == nil {
			failedCount++
			log.Printf("[Trash] scan failed type=%s (%T)", itemType, failure)
		}

		log.Printf(
			"[Trash] cleanup type=%s deleted=%d failed=%d elapsed=%s",
			itemType, deletedCount, failedCount, time.Since(started),
		)
	}()

	for {
		if ctx.Err() != nil {
			return
		}

		ids := func() []int64 {
			queryCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()

			return scan(s.db.WithContext(queryCtx), afterID)
		}()

		if len(ids) == 0 {
			return
		}

		for _, id := range ids {
			if ctx.Err() != nil {
				return
			}

			deleted, err := s.cleanupTrashItem(ctx, id, purge)
			afterID = id

			if err != nil {
				if ctx.Err() != nil {
					return
				}

				failedCount++
				log.Printf(
					"[Trash] item failed type=%s id=%d error=%v",
					itemType, id, err,
				)
				continue
			}

			if deleted {
				deletedCount++
			}
		}
	}
}

// cleanupTrashOnce 执行一轮清理，先处理文件夹，再处理剩余文档。
func (s *Service) cleanupTrashOnce(ctx context.Context) {
	s.cleanupTrashType(
		ctx,
		"folder",
		repository.TrashExpiredFolderIDs,
		repository.TrashPurgeExpiredFolder,
	)

	s.cleanupTrashType(
		ctx,
		"document",
		repository.TrashExpiredDocumentIDs,
		repository.TrashPurgeExpiredDocument,
	)
}

// RunTrashCleanup 启动时清理一次，之后每小时清理，直到收到取消通知。
func (s *Service) RunTrashCleanup(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()

	s.cleanupTrashOnce(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.cleanupTrashOnce(ctx)
		}
	}
}
