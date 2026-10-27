// Package service implements business rules independently of the HTTP framework.
package service

import (
	"context"
	"sync"
	"voex-server/internal/config"
	"voex-server/internal/filestore"
	"voex-server/internal/repository"
	"voex-server/internal/security"

	"gorm.io/gorm"
)

type Service struct {
	collab           *collaborationRuntime
	collabSchema     bool
	collabModeColumn bool
	db               *gorm.DB
	secret           []byte
	shareSecret      []byte
	hashSlots        chan struct{}
	dummyHash        string
	recentCleanups   sync.Map
	Files            *filestore.Store
}

func New(db *gorm.DB, files *filestore.Store, secret []byte) *Service {
	return &Service{db: db, Files: files, secret: secret, shareSecret: security.LoadSecret(config.Env("SHARE_SECRET_FILE", "/home/server/.secrets/share-key")), hashSlots: make(chan struct{}, 4), dummyHash: hashPassword(randomPassword())}
}

func (s *Service) tx(ctx context.Context, write bool, fn func(*gorm.DB) any) any {
	return repository.Transaction(ctx, s.db, write, fn)
}
