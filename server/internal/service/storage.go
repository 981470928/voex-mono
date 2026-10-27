package service

import (
	"context"
	"regexp"
	"unicode/utf8"

	"gorm.io/gorm"
	"voex-server/internal/filestore"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"
)

var attachmentHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var assetMimePattern = regexp.MustCompile(`^[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+$`)

func attachmentHash(value string) string {
	if !attachmentHashPattern.MatchString(value) {
		shared.Fail(400, "附件标识不合法")
	}
	return value
}

func (s *Service) UploadAsset(ctx context.Context, upload filestore.Upload) shared.Row {
	defer upload.Remove()
	user := identity.User(ctx)
	if upload.Path == "" || upload.Size == 0 {
		shared.Fail(400, "请选择非空文件")
	}
	directory := filestore.SafeDirectory(upload.Fields["path"])
	id := shared.UUID()
	asset := s.Files.SaveAsset(ctx, upload, id, directory)
	committed := false
	defer func() {
		if !committed {
			asset.Remove()
		}
	}()
	name := []rune(upload.Name)
	if len(name) > 255 {
		name = name[:255]
	}
	repository.CreateAsset(s.db.WithContext(ctx), shared.Row{"id": id, "creator_id": user["id"], "directory": directory, "storage_name": asset.StorageName, "name": string(name), "mime": asset.MIME, "size": asset.Size})
	committed = true
	return shared.Row{"id": id, "name": string(name), "url": "/api/assets/" + id, "path": directory, "size": asset.Size, "mime": asset.MIME, "creator": shared.Creator(user)}
}

func (s *Service) AssetDownload(ctx context.Context, id string) filestore.Download {
	asset := repository.AccessibleAsset(s.db.WithContext(ctx), id, shared.String(identity.User(ctx)["id"]))
	if asset == nil {
		shared.Fail(404, "文件不存在")
	}
	return filestore.Download{Key: s.Files.AssetKey(shared.String(asset["directory"]), shared.String(asset["storage_name"])), Name: shared.String(asset["name"]), MIME: shared.String(asset["mime"]), Inline: filestore.IsImageMIME(shared.String(asset["mime"])), SameOrigin: true, Cache: "private, no-store", Missing: "文件不存在"}
}

func (s *Service) UploadAttachment(ctx context.Context, upload filestore.Upload) shared.Row {
	defer upload.Remove()
	user := identity.User(ctx)
	if upload.Path == "" {
		shared.Fail(400, "请选择文件")
	}
	fileKey := shared.Key(upload.Fields["fileKey"], "文档标识")
	// Check authorization before reading the uploaded body for its content hash.
	s.tx(ctx, false, func(db *gorm.DB) any { return s.FindDocument(db, ctx, fileKey, "write", false) })
	hash := filestore.ComputeHash(upload.Path)
	name, mimeType := upload.Name, upload.MIME
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if value, ok := upload.Fields["file_name"]; ok {
		name = shared.String(value)
	}
	if value, ok := upload.Fields["mime"]; ok {
		mimeType = shared.String(value)
	}
	if name == "" || utf8.RuneCountInString(name) > 255 || len(mimeType) > 128 || !assetMimePattern.MatchString(mimeType) {
		shared.Fail(400, "文件名或文件类型不合法")
	}
	// File I/O must not hold the workspace's global write lock. A failed commit
	// may leave a shared hash object, which is retained just like deleted attachments.
	s.Files.SaveAttachment(ctx, upload, hash)
	s.txEvent(ctx, "attachments", fileKey, func(db *gorm.DB) any {
		s.FindDocument(db, ctx, fileKey, "write", false)
		repository.CreateAttachment(db, shared.Row{"file_key": fileKey, "hash": hash, "name": name, "mime": mimeType, "size": upload.Size, "creator_id": user["id"], "privileges": `{"mode":"inherit"}`})
		return nil
	})
	return shared.Row{"hash": hash, "creator": shared.Creator(user)}
}

func (s *Service) ListAttachments(ctx context.Context, rawKey string) []shared.Row {
	fileKey := shared.Key(rawKey, "文档标识")
	return s.tx(ctx, false, func(db *gorm.DB) any {
		s.FindDocument(db, ctx, fileKey, "read", false)
		files := repository.ListAttachments(db, fileKey)
		result := make([]shared.Row, 0, len(files))
		for _, file := range files {
			result = append(result, shared.Row{"hash": file["hash"], "name": file["name"], "mime": file["mime"], "privileges": shared.Row{"mode": "inherit"}, "creator": shared.Row{"id": file["creator_id"], "name": file["creator_name"], "avator": file["creator_avator"]}})
		}
		return result
	}).([]shared.Row)
}

func (s *Service) findAttachment(db *gorm.DB, ctx context.Context, fileKey, hash, action string) shared.Row {
	s.FindDocument(db, ctx, fileKey, action, false)
	file := repository.AttachmentByHash(db, fileKey, hash)
	if file == nil {
		shared.Fail(404, "附件不存在")
	}
	return file
}

func (s *Service) AttachmentDownload(ctx context.Context, rawKey, rawHash string) filestore.Download {
	fileKey, hash := shared.Key(rawKey, "文档标识"), attachmentHash(rawHash)
	file := s.tx(ctx, false, func(db *gorm.DB) any { return s.findAttachment(db, ctx, fileKey, hash, "read") }).(shared.Row)
	return filestore.Download{Key: s.Files.AttachmentKey(hash), Name: shared.String(file["name"]), MIME: "application/octet-stream", Cache: "private, no-store", Missing: "附件文件不存在"}
}

func (s *Service) AttachmentProgress(ctx context.Context, rawKey, rawHash string) shared.Row {
	fileKey, hash := shared.Key(rawKey, "文档标识"), attachmentHash(rawHash)
	file := s.tx(ctx, false, func(db *gorm.DB) any { return s.findAttachment(db, ctx, fileKey, hash, "read") }).(shared.Row)
	return shared.Row{"uploadId": hash, "status": "COMPLETED", "totalBytes": shared.Int64(file["size"]), "persistedBytes": shared.Int64(file["size"]), "uploadedPercent": 100}
}

func (s *Service) DeleteAttachment(ctx context.Context, rawKey, rawHash string) {
	fileKey, hash := shared.Key(rawKey, "文档标识"), attachmentHash(rawHash)
	s.txEvent(ctx, "attachments", fileKey, func(db *gorm.DB) any {
		s.findAttachment(db, ctx, fileKey, hash, "write")
		repository.DeleteAttachment(db, fileKey, hash)
		// Shared content hashes stay in local storage; deleting a record must not remove them.
		return nil
	})
}
