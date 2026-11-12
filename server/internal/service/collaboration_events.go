package service

import (
	"context"
	"gorm.io/gorm"
	"log"
	"strings"
	"time"
	"voex-server/internal/dbschema"
	"voex-server/internal/repository"
)

// The outbox row and domain mutation commit atomically; delivery never holds a DB transaction.
// outbox 记录与业务变更原子提交；事件投递期间不持有数据库事务。
func (s *Service) txEvent(ctx context.Context, kind, key string, fn func(*gorm.DB) any) any {
	return s.tx(ctx, true, func(db *gorm.DB) any {
		result := fn(db)
		if s.collabSchema {
			repository.CollaborationEvent(db, kind, key)
		}
		return result
	})
}
func (s *Service) RunCollaborationEvents(ctx context.Context) {
	if s.collab == nil {
		return
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.deliverCollaborationEvents(ctx)
		}
	}
}
func (s *Service) deliverCollaborationEvents(ctx context.Context) {
	defer func() {
		if problem := recover(); problem != nil {
			log.Printf("[Collaboration] event delivery failed (%T)", problem)
		}
	}()
	deadline, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	// Cleanup is independent of delivery: a stopped Node process must not keep
	// expired grants or idempotency receipts alive indefinitely.
	// 清理独立于事件投递；即使 Node 进程停止，
	// 过期授权和幂等回执也不能被无限期保留。
	now := time.Now()
	s.collab.mu.Lock()
	for key, g := range s.collab.grants {
		if !now.Before(g.Expires) ||
			(strings.HasPrefix(key, "ticket:") && !now.Before(g.TicketExpires)) {
			delete(s.collab.grants, key)
		}
	}
	s.collab.mu.Unlock()
	if now.Sub(s.collab.lastReceiptCleanup) >= time.Minute {
		s.collab.lastReceiptCleanup = now
		repository.Must(
			s.db.WithContext(deadline).
				Exec("DELETE FROM " +
					dbschema.CollaborationCommits.Name +
					" WHERE " +
					dbschema.CollaborationCommits.Columns.CREATED_AT +
					" < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 7 DAY) ORDER BY " +
					dbschema.CollaborationCommits.Columns.CREATED_AT +
					" LIMIT 1000"),
		)
	}
	rows := repository.Rows(
		s.db.WithContext(deadline).
			Table(dbschema.CollaborationOutbox.Name).
			Order(dbschema.CollaborationOutbox.Columns.ID).
			Limit(100),
	)
	if len(rows) > 0 {
		if err := s.collaborationCall(
			deadline,
			"events",
			map[string]any{"events": rows},
			nil,
		); err != nil {
			return
		}
		ids := make([]any, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row[dbschema.CollaborationOutbox.Columns.ID])
		}
		repository.Must(
			s.db.WithContext(deadline).
				Table(dbschema.CollaborationOutbox.Name).
				Where(dbschema.CollaborationOutbox.Columns.ID+" IN ?", ids).
				Delete(&map[string]any{}),
		)
	}

}
