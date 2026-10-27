package filestore

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"voex-server/internal/config"
	"voex-server/internal/shared"
)

// Store keeps immutable objects and private upload staging in one local volume.
// All object access is rooted: symlinks can never escape the configured directory.
type Store struct {
	root    *os.Root
	tempDir string
	tempKey string
}

func New(settings config.Storage) (*Store, error) {
	if !filepath.IsAbs(settings.Root) {
		return nil, fmt.Errorf("VOEX_STORAGE_ROOT must be an absolute path")
	}
	name := filepath.Clean(settings.Root)
	if name == string(filepath.Separator) {
		return nil, fmt.Errorf("VOEX_STORAGE_ROOT must be a dedicated directory")
	}
	root, err := openStorageRoot(name)
	if err != nil {
		return nil, err
	}
	ready := false
	defer func() {
		if !ready {
			_ = root.Close()
		}
	}()
	if err := root.Mkdir(".uploads", 0700); err != nil && !errors.Is(err, fs.ErrExist) {
		return nil, fmt.Errorf("create upload staging: %w", err)
	}
	info, err := root.Lstat(".uploads")
	if err != nil {
		return nil, fmt.Errorf("inspect upload staging: %w", err)
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return nil, fmt.Errorf("upload staging must be a private real directory")
	}
	tempKey := ".uploads/" + shared.UUID()
	if err := root.Mkdir(tempKey, 0700); err != nil {
		return nil, fmt.Errorf("create private upload directory: %w", err)
	}
	ready = true
	return &Store{root: root, tempKey: tempKey, tempDir: filepath.Join(name, filepath.FromSlash(tempKey))}, nil
}

// Walk from a pinned filesystem root so a pre-existing symlink is rejected
// before creating anything beneath it. Each next directory stays within its parent.
func openStorageRoot(name string) (*os.Root, error) {
	current, err := os.OpenRoot(string(filepath.Separator))
	if err != nil {
		return nil, err
	}
	for _, part := range strings.Split(strings.TrimPrefix(name, string(filepath.Separator)), string(filepath.Separator)) {
		if err := current.Mkdir(part, 0700); err != nil && !errors.Is(err, fs.ErrExist) {
			_ = current.Close()
			return nil, fmt.Errorf("create storage root: %w", err)
		}
		info, err := current.Lstat(part)
		if err != nil {
			_ = current.Close()
			return nil, fmt.Errorf("inspect storage root: %w", err)
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			_ = current.Close()
			return nil, fmt.Errorf("VOEX_STORAGE_ROOT must contain only real directories")
		}
		child, err := current.OpenRoot(part)
		_ = current.Close()
		if err != nil {
			return nil, fmt.Errorf("open storage root: %w", err)
		}
		current = child
	}
	return current, nil
}

// Close removes only the empty process directory; unfinished uploads are not swept.
func (s *Store) Close() {
	_ = s.root.Remove(s.tempKey)
	_ = s.root.Close()
}

func (s *Store) createUpload() (*os.File, string, error) {
	name := s.tempKey + "/" + shared.UUID()
	file, err := s.root.OpenFile(name, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	return file, filepath.Join(s.root.Name(), filepath.FromSlash(name)), err
}

func validObjectKey(key string) bool {
	if hash, ok := strings.CutPrefix(key, "attachments/"); ok {
		return attachmentHashPattern.MatchString(hash)
	}
	value, ok := strings.CutPrefix(key, "assets/")
	if !ok {
		return false
	}
	directory, storageName := path.Dir(value), path.Base(value)
	return len(directory) <= 255 && directoryPattern.MatchString(directory) && assetStoragePattern.MatchString(storageName)
}

// Validate every existing component, in addition to os.Root's race-safe boundary.
func (s *Store) checkObjectPath(key string) error {
	if !validObjectKey(key) {
		return fs.ErrInvalid
	}
	current := ""
	for _, part := range strings.Split(key, "/") {
		current = path.Join(current, part)
		info, err := s.root.Lstat(current)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fs.ErrPermission
		}
		if (current != key && !info.IsDir()) || (current == key && !info.Mode().IsRegular()) {
			return fs.ErrInvalid
		}
	}
	return nil
}

func (s *Store) openObject(key string) (*os.File, os.FileInfo, error) {
	if err := s.checkObjectPath(key); err != nil {
		return nil, nil, err
	}
	file, err := s.root.Open(key)
	if err != nil {
		return nil, nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = file.Close()
		if err == nil {
			err = fs.ErrInvalid
		}
		return nil, nil, err
	}
	return file, info, nil
}

func (s *Store) putObject(ctx context.Context, key, filename, _ string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !validObjectKey(key) {
		return fs.ErrInvalid
	}
	source, err := filepath.Rel(s.root.Name(), filename)
	if err != nil || filepath.Dir(filename) != s.tempDir || !filepath.IsLocal(source) {
		return fs.ErrInvalid
	}
	info, err := s.root.Lstat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fs.ErrInvalid
	}
	file, err := s.root.OpenFile(source, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	err = file.Sync()
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	directory := path.Dir(key)
	if err := s.root.MkdirAll(directory, 0700); err != nil {
		return err
	}
	// Check parents without requiring the destination to exist yet.
	if err := s.checkObjectPath(key); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// link(2) publishes the fully written inode atomically and never replaces a key.
	if err := s.root.Link(source, key); err != nil {
		if !errors.Is(err, fs.ErrExist) {
			return err
		}
		existing, _, openErr := s.openObject(key)
		if openErr != nil {
			return openErr
		}
		_ = existing.Close()
		return fs.ErrExist
	}
	parent, err := s.root.Open(directory)
	if err == nil {
		err = parent.Sync()
		closeErr = parent.Close()
		if err == nil {
			err = closeErr
		}
	}
	if err != nil {
		// Publication failed durability checks, so callers must not commit its metadata.
		_ = s.root.Remove(key)
	}
	return err
}

func (s *Store) removeAsset(key string) {
	if !strings.HasPrefix(key, "assets/") || !validObjectKey(key) {
		logStorageError("rollback asset", fs.ErrInvalid)
		return
	}
	if err := s.checkObjectPath(key); err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			logStorageError("rollback asset", err)
		}
		return
	}
	if err := s.root.Remove(key); err != nil && !errors.Is(err, fs.ErrNotExist) {
		logStorageError("rollback asset", err)
	}
}

func storageStatus(err error) int {
	if errors.Is(err, fs.ErrNotExist) {
		return http.StatusNotFound
	}
	if errors.Is(err, fs.ErrExist) {
		return http.StatusPreconditionFailed
	}
	return 0
}

// Never expose physical paths through storage error logs or API responses.
func logStorageError(operation string, err error) {
	log.Printf("[storage] %s failed (status=%d type=%T)", operation, storageStatus(err), err)
}

func storageFailure(operation string, err error) {
	logStorageError(operation, err)
	shared.Fail(http.StatusBadGateway, "文件存储服务暂不可用，请稍后重试")
}
