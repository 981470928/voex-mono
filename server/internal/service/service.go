// Package service implements business rules independently of the HTTP framework.
// service 包实现业务规则，不依赖 HTTP 框架。
package service

import (
	"context"
	"sync"
	"time"
	"voex-server/internal/config"
	"voex-server/internal/filestore"
	"voex-server/internal/repository"
	"voex-server/internal/security"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

type Service struct {
	collab             *collaborationRuntime
	collabSchema       bool
	collabModeColumn   bool
	historyEnabled     bool
	historyInterval    time.Duration
	historyMaxVersions int64
	webSearchKeys      map[string]string
	db                 *gorm.DB
	secret             []byte
	shareSecret        []byte
	hashSlots          chan struct{}
	dummyHash          string
	recentCleanups     sync.Map
	transferOnce       sync.Once
	transfers          *documentTransferRuntime
	Files              *filestore.Store
}

func New(db *gorm.DB, files *filestore.Store, secret []byte) *Service {
	return &Service{
		db:     db,
		Files:  files,
		secret: secret,
		shareSecret: security.LoadSecret(
			config.Env("SHARE_SECRET_FILE", "/home/server/.secrets/share-key"),
		),
		hashSlots: make(chan struct{}, 4),
		dummyHash: hashPassword(randomPassword()),
	}
}

func (s *Service) tx(ctx context.Context, write bool, fn func(*gorm.DB) any) any {
	return repository.Transaction(ctx, s.db, write, fn)
}

// bestEffortWrite runs optional side effects only after the main transaction ends.
// Use a short deadline and a separate autocommit statement so failures cannot
// roll back successful reads/writes or hold the workspace lock.
// bestEffortWrite 仅在主事务结束后执行可选副作用。
// 使用较短的截止时间和独立的自动提交语句，防止失败回滚
// 已成功的读写操作，或占用工作区锁。
func (s *Service) bestEffortWrite(ctx context.Context, operation string, fn func(*gorm.DB)) {
	defer func() {
		if failure := recover(); failure != nil {
			shared.LogFailure(operation, failure)
		}
	}()
	deadline, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	fn(s.db.WithContext(deadline))
}
