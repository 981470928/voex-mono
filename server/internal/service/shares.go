package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"regexp"
	"strings"

	"gorm.io/gorm"
	"voex-server/internal/filestore"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"
)

var shareAvatarPattern = regexp.MustCompile(`^/api/assets/([a-f0-9-]{36})$`)
var shareAvatarStoragePattern = regexp.MustCompile(`^[a-f0-9-]{36}(\.webp)?$`)

func (s *Service) shareToken(key, mode string) string {
	payload := "v1." + key + "." + mode
	mac := hmac.New(sha256.New, s.shareSecret)
	mac.Write([]byte("voex-file-share:" + payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Service) sharedDocument(db *gorm.DB, ctx context.Context, token string) (shared.Row, shared.Row) {
	return s.sharedDocumentContent(db, ctx, token, true)
}
func (s *Service) sharedDocumentContent(db *gorm.DB, ctx context.Context, token string, content bool) (shared.Row, shared.Row) {
	parts := strings.Split(token, ".")
	if len(parts) != 4 || parts[0] != "v1" || (parts[2] != "read" && parts[2] != "edit") || !hmac.Equal([]byte(token), []byte(s.shareToken(parts[1], parts[2]))) {
		shared.Fail(404, "分享链接无效")
	}
	doc := repository.DocumentByKey(db, parts[1], content)
	if doc == nil {
		shared.Fail(404, "文件不存在")
	}
	settings := repository.DocumentSharing(db, doc["id"])
	enabled := shared.Bool(settings[parts[2]+"_enabled"])
	access := shared.Row{"read": false, "write": false}
	if identity.OptionalUser(ctx) != nil {
		access = s.DocumentPermissions(db, ctx, doc)
	}
	if !enabled && !shared.Bool(access["read"]) {
		shared.Fail(403, "你没有权限")
	}
	doc["share_permission"] = parts[2]
	doc["share_enabled"] = enabled
	return doc, shared.Row{"read": true, "write": shared.Bool(access["write"]) || (enabled && parts[2] == "edit"), "manage": false, "share": false}
}

func (s *Service) DocumentSharing(ctx context.Context, key string) shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		doc := s.FindDocument(db, ctx, key, "share", false)
		manage := shared.Bool(s.ProjectPermissions(db, ctx, shared.String(doc["project_key"]))["write"])
		settings := repository.DocumentSharing(db, doc["id"])
		links := []shared.Row{}
		for _, mode := range []string{"read", "edit"} {
			links = append(links, shared.Row{"permission": mode, "token": s.shareToken(key, mode), "enabled": shared.Bool(settings[mode+"_enabled"])})
		}
		access := []shared.Row{}
		if manage {
			for _, row := range repository.DocumentAccessList(db, doc["id"]) {
				userCtx := identity.WithUser(ctx, shared.Row{"id": row["user_id"]}, "")
				project := s.ProjectPermissions(db, userCtx, shared.String(doc["project_key"]))
				if shared.Bool(project["write"]) {
					continue
				}
				member := shared.Bool(project["read"])
				if member && shared.String(row["permission"]) != "edit" {
					continue
				}
				row["member"] = member
				access = append(access, row)
			}
		}
		return shared.Row{"links": links, "can_manage": manage, "access": access}
	}).(shared.Row)
}
func (s *Service) SetDocumentSharing(ctx context.Context, key string, input shared.Row) {
	mode := shared.String(input["permission"])
	enabled, ok := input["enabled"].(bool)
	if !ok || (mode != "read" && mode != "edit") || len(input) != 2 {
		shared.Fail(400, "请选择分享类型与开关状态")
	}
	s.txEvent(ctx, "permissions", key, func(db *gorm.DB) any {
		doc := s.FindDocument(db, ctx, key, "manage", false)
		repository.SetDocumentSharing(db, doc["id"], mode, enabled)
		return nil
	})
}
func (s *Service) RevokeDocumentAccess(ctx context.Context, key, userID string) {
	s.txEvent(ctx, "permissions", key, func(db *gorm.DB) any {
		doc := s.FindDocument(db, ctx, key, "manage", false)
		target := identity.WithUser(ctx, shared.Row{"id": userID}, "")
		project := s.ProjectPermissions(db, target, shared.String(doc["project_key"]))
		grant := repository.DocumentAccess(db, doc["id"], userID)
		if shared.Bool(project["write"]) || (shared.Bool(project["read"]) && grant != "edit") {
			shared.Fail(403, "不能在此取消团队或项目权限")
		}
		repository.RemoveDocumentAccess(db, doc["id"], userID)
		return nil
	})
}

func limitedDocumentDTO(db *gorm.DB, doc, permissions shared.Row, avatar string) shared.Row {
	rows := repository.ListSharedAttachments(db, shared.String(doc["file_key"]))
	attachments := make([]shared.Row, 0, len(rows))
	for _, file := range rows {
		attachments = append(attachments, shared.Row{"hash": file["hash"], "name": file["name"], "mime": file["mime"], "creator": shared.Row{"id": file["creator_id"], "name": file["creator_name"], "avator": ""}})
	}
	// A capability exposes only this document, never parent or contact data.
	return shared.Row{"file_key": doc["file_key"], "file_name": doc["file_name"], "file_content": shared.String(doc["file_content"]), "created_at": shared.Timestamp(doc["created_at"]), "updated_at": shared.Timestamp(doc["updated_at"]), "revision": shared.Int64(doc["revision"]), "privileges": shared.Row{"mode": "inherit"}, "permissions": permissions, "creator": shared.Row{"id": doc["creator_id"], "name": shared.String(doc["creator_name"]), "avator": avatar}, "attachments": attachments}
}

func (s *Service) GetSharedDocument(ctx context.Context, token string, recordVisit bool) shared.Row {
	user := identity.OptionalUser(ctx)
	recordVisit = recordVisit && user != nil
	return s.tx(ctx, recordVisit, func(db *gorm.DB) any {
		doc, permissions := s.sharedDocument(db, ctx, token)
		if recordVisit {
			existing := s.DocumentPermissions(db, ctx, doc)
			mode := shared.String(doc["share_permission"])
			if shared.Bool(doc["share_enabled"]) && !shared.Bool(existing["write"]) && (mode == "edit" || !shared.Bool(existing["read"])) {
				repository.GrantDocumentAccess(db, doc["id"], shared.String(user["id"]), mode)
			}
			repository.RecordRecentFile(db, shared.String(user["id"]), doc)
		}
		avator := ""
		if shared.String(doc["creator_avator"]) != "" {
			avator = "/api/shared-file/creator-avator"
		}
		return s.addCollaborationMetadata(db, shared.String(doc["file_key"]), limitedDocumentDTO(db, doc, permissions, avator))
	}).(shared.Row)
}

func (s *Service) SharedAttachment(ctx context.Context, token, hash string) filestore.Download {
	if !attachmentHashPattern.MatchString(hash) {
		shared.Fail(404, "附件不存在")
	}
	file := s.tx(ctx, false, func(db *gorm.DB) any {
		doc, _ := s.sharedDocument(db, ctx, token)
		file := repository.AttachmentByHash(db, shared.String(doc["file_key"]), hash)
		if file == nil {
			shared.Fail(404, "附件不存在")
		}
		return file
	}).(shared.Row)
	return filestore.Download{Key: s.Files.AttachmentKey(hash), Name: shared.String(file["name"]), MIME: "application/octet-stream", Cache: "no-store", Missing: "文件不存在"}
}

func (s *Service) SharedAvatar(ctx context.Context, token string) filestore.Download {
	asset := s.tx(ctx, false, func(db *gorm.DB) any {
		doc, _ := s.sharedDocument(db, ctx, token)
		match := shareAvatarPattern.FindStringSubmatch(shared.String(doc["creator_avator"]))
		if match == nil {
			shared.Fail(404, "没有头像")
		}
		asset := repository.SharedCreatorAvatar(db, match[1], doc["creator_id"])
		if asset == nil {
			shared.Fail(404, "没有头像")
		}
		return asset
	}).(shared.Row)
	if !shareAvatarStoragePattern.MatchString(shared.String(asset["storage_name"])) {
		shared.Fail(404, "没有头像")
	}
	return filestore.Download{Key: s.Files.AssetKey("avator", shared.String(asset["storage_name"])), Name: "avator", MIME: shared.String(asset["mime"]), Inline: true, Cache: "no-store", Missing: "文件不存在"}
}
