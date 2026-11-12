package service

import (
	"context"
	"log"
	"time"
	"voex-server/internal/dbschema"
	"voex-server/internal/repository"

	"gorm.io/gorm"
)

const historyCleanupBatch = 500

// RunHistoryCleanup 定期稀释自动快照：manual/backup 永久保留，auto 按
// 7 天内全保 → 超过 7 天至 30 天每小时留 1 条 → 超过 30 天至 90 天每日留 1 条 → 更旧删除；
// 自动快照超过 VOEX_HISTORY_MAX_VERSIONS 的文档裁剪最旧条目。
func (s *Service) RunHistoryCleanup(ctx context.Context) {
	if !s.historyEnabled {
		return
	}
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	s.cleanupHistoryOnce(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.cleanupHistoryOnce(ctx)
		}
	}
}

func (s *Service) cleanupHistoryOnce(ctx context.Context) {
	started := time.Now()
	deleted := int64(0)
	deadline, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	defer func() {
		if failure := recover(); failure != nil && ctx.Err() == nil {
			log.Printf("[History] cleanup failed (%T)", failure)
		}
		log.Printf("[History] cleanup deleted=%d elapsed=%s", deleted, time.Since(started))
	}()
	deleted += s.cleanupHistoryBatch(deadline, func(db *gorm.DB) []int64 {
		return repository.ExpiredAutoVersionIDs(db, "90 DAY", historyCleanupBatch)
	})
	deleted += s.cleanupHistoryBatch(deadline, func(db *gorm.DB) []int64 {
		return repository.ThinnedAutoVersionIDs(
			db,
			"DATE_FORMAT("+dbschema.DocumentVersions.Columns.CREATED_AT+", '%Y%m%d')",
			"90 DAY",
			"30 DAY",
			historyCleanupBatch,
		)
	})
	deleted += s.cleanupHistoryBatch(deadline, func(db *gorm.DB) []int64 {
		return repository.ThinnedAutoVersionIDs(
			db,
			"DATE_FORMAT("+dbschema.DocumentVersions.Columns.CREATED_AT+", '%Y%m%d%H')",
			"30 DAY",
			"7 DAY",
			historyCleanupBatch,
		)
	})
	deleted += s.cleanupHistoryOverflow(deadline)
}

// cleanupHistoryBatch 循环删除候选版本，直到没有候选或到达截止时间。
func (s *Service) cleanupHistoryBatch(
	ctx context.Context,
	candidates func(*gorm.DB) []int64,
) int64 {
	deleted := int64(0)
	for ctx.Err() == nil {
		ids := candidates(s.db.WithContext(ctx))
		if len(ids) == 0 {
			return deleted
		}
		removed := s.cleanupHistoryDelete(ctx, ids)
		deleted += removed
		if removed == 0 {
			return deleted
		}
	}
	return deleted
}

// cleanupHistoryOverflow 按 id 升序裁剪自动快照超过上限的文档，一次处理 20 个文档。
func (s *Service) cleanupHistoryOverflow(ctx context.Context) int64 {
	deleted := int64(0)
	for _, row := range repository.OverflowDocumentVersions(
		s.db.WithContext(ctx),
		s.historyMaxVersions,
		20,
	) {
		documentID := row[dbschema.DocumentVersions.Columns.DOCUMENT_ID]
		for ctx.Err() == nil {
			excess := repository.CountAutoDocumentVersions(
				s.db.WithContext(ctx),
				documentID,
			) - s.historyMaxVersions
			if excess <= 0 {
				break
			}
			batch := historyCleanupBatch
			if int64(batch) > excess {
				batch = int(excess)
			}
			ids := repository.AutoVersionIDs(s.db.WithContext(ctx), documentID, batch)
			if len(ids) == 0 {
				break
			}
			removed := s.cleanupHistoryDelete(ctx, ids)
			deleted += removed
			if removed == 0 {
				break
			}
		}
	}
	return deleted
}

// cleanupHistoryDelete 以单条自动提交语句删除自动版本，不占工作区锁；失败不影响其他批次。
func (s *Service) cleanupHistoryDelete(ctx context.Context, ids []int64) (removed int64) {
	defer func() {
		if failure := recover(); failure != nil {
			removed = 0
			log.Printf("[History] delete failed (%T)", failure)
		}
	}()
	batchCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return repository.DeleteDocumentVersions(s.db.WithContext(batchCtx), ids)
}
