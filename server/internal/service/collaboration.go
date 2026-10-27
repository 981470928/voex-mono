package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
	"voex-server/internal/config"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"
)

const collaborationSchema = "voex-editor-1"

type collaborationResponseError struct{ StatusCode int }

func (e *collaborationResponseError) Error() string {
	return fmt.Sprintf("collaboration request rejected (%d)", e.StatusCode)
}

type collaborationGrant struct {
	Epoch                                                       int64
	FileKey, Access, ShareToken, UserID, SessionID, AnonymousID string
	Expires, TicketExpires                                      time.Time
}
type collaborationRuntime struct {
	lastReceiptCleanup time.Time
	config             config.Collaboration
	secret             []byte
	client             *http.Client
	mu                 sync.Mutex
	grants             map[string]collaborationGrant
}

func (s *Service) ConfigureCollaboration(cfg config.Collaboration) error {
	s.collabModeColumn = s.db.Migrator().HasColumn("documents", "content_mode")
	s.collabSchema = s.collabModeColumn && s.db.Migrator().HasTable("document_collaboration") && s.db.Migrator().HasTable("collaboration_outbox") && s.db.Migrator().HasTable("collaboration_commits")
	if !cfg.Enabled {
		return nil
	}
	if !s.collabSchema {
		return fmt.Errorf("collaboration schema missing; apply internal/database/collaboration.sql")
	}
	endpoint, err := url.Parse(cfg.URL)
	if err != nil || endpoint.Scheme != "http" || endpoint.User != nil || (endpoint.Hostname() != "localhost" && (net.ParseIP(endpoint.Hostname()) == nil || !net.ParseIP(endpoint.Hostname()).IsLoopback())) {
		return fmt.Errorf("VOEX_COLLAB_URL must use loopback HTTP")
	}
	secret, err := os.ReadFile(cfg.SecretFile)
	if err != nil {
		return fmt.Errorf("collaboration service secret unavailable")
	}
	secret = bytes.TrimSpace(secret)
	if len(secret) < 32 {
		return fmt.Errorf("collaboration secret must contain at least 32 bytes")
	}
	s.collab = &collaborationRuntime{config: cfg, secret: secret, client: &http.Client{Timeout: 20 * time.Second}, grants: map[string]collaborationGrant{}}
	return nil
}
func (s *Service) CollaborationInternal(secret string) bool {
	return s.collab != nil && hmac.Equal(s.collab.secret, []byte(secret))
}
func (s *Service) collaborationCall(ctx context.Context, path string, input, output any) error {
	if s.collab == nil {
		return fmt.Errorf("collaboration disabled")
	}
	data, err := json.Marshal(input)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.collab.config.URL, "/")+"/internal/collab/"+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Collab-Secret", string(s.collab.secret))
	res, err := s.collab.client.Do(req)
	if err != nil {
		return fmt.Errorf("collaboration service unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return &collaborationResponseError{StatusCode: res.StatusCode}
	}
	if output != nil {
		return json.NewDecoder(io.LimitReader(res.Body, 40<<20)).Decode(output)
	}
	return nil
}
func (s *Service) CollaborationReady(ctx context.Context) error {
	if s.collab == nil {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(s.collab.config.URL, "/")+"/health/ready", nil)
	if err != nil {
		return err
	}
	res, err := s.collab.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("collaboration service unavailable")
	}
	return nil
}
func (s *Service) resolveCollaboration(db *gorm.DB, ctx context.Context, key, access, share string, content bool) (shared.Row, shared.Row) {
	switch access {
	case "workspace":
		doc := s.FindDocument(db, ctx, key, "read", content)
		return doc, doc["permissions"].(shared.Row)
	case "recent":
		doc, permissions, _ := s.findRecentFile(db, ctx, key, "read", content)
		return doc, permissions
	case "share":
		doc, permissions := s.sharedDocumentContent(db, ctx, share, content)
		if shared.String(doc["file_key"]) != key {
			shared.Fail(403, "分享与协同文档不匹配")
		}
		if identity.OptionalUser(ctx) == nil {
			permissions["write"] = false
		}
		return doc, permissions
	default:
		shared.Fail(400, "文件访问方式无效")
	}
	return nil, nil
}
func collaborationUser(ctx context.Context, anonymous string) shared.Row {
	u := identity.OptionalUser(ctx)
	id, name, avator := anonymous, "访客", ""
	if u != nil {
		id = shared.String(u["id"])
		name = shared.String(u["name"])
		avator = shared.String(u["avator"])
	}
	digest := sha256.Sum256([]byte(id))
	colors := []string{"#2563eb", "#9333ea", "#0891b2", "#dc2626", "#059669", "#d97706"}
	return shared.Row{"id": id, "name": name, "avator": avator, "color": colors[int(digest[0])%len(colors)]}
}
func (s *Service) addCollaborationMetadata(db *gorm.DB, key string, result shared.Row) shared.Row {
	result["content_mode"] = "legacy"
	result["schema_version"] = collaborationSchema
	result["epoch"] = int64(1)
	if s.collabModeColumn {
		result["content_mode"] = repository.CollaborationMode(db, key)
	}
	if s.collabSchema {
		doc := repository.DocumentByKey(db, key, false)
		if doc != nil {
			if state := repository.CollaborationMetadata(db, doc["id"]); state != nil {
				result["schema_version"] = state.SchemaVersion
				result["epoch"] = state.Epoch
			}
		}
	}
	return result
}
func (s *Service) CollaborationTicket(ctx context.Context, key, access, share, accessToken string) shared.Row {
	key = shared.Key(key, "文件标识")
	return s.tx(ctx, false, func(db *gorm.DB) any {
		doc, permissions := s.resolveCollaboration(db, ctx, key, access, share, false)
		result := s.addCollaborationMetadata(db, key, shared.Row{"enabled": s.collab != nil, "file_key": key, "file_name": doc["file_name"], "document_name": key, "permissions": permissions})
		if s.collab == nil {
			return result
		}
		expires := time.Now().Add(15 * time.Minute)
		if claims, ok := s.verifyAccess(accessToken, false); ok {
			if exp := time.Unix(shared.Int64(claims["exp"]), 0); exp.Before(expires) {
				expires = exp
			}
		}
		g := collaborationGrant{Epoch: shared.Int64(result["epoch"]), FileKey: key, Access: access, ShareToken: share, UserID: shared.String(identity.OptionalUser(ctx)["id"]), SessionID: identity.SessionID(ctx), AnonymousID: "guest-" + shared.RandomToken(9), Expires: expires, TicketExpires: time.Now().Add(time.Minute)}
		ticket := shared.RandomToken(32)
		s.collab.mu.Lock()
		s.collab.grants["ticket:"+shared.Digest(ticket)] = g
		s.collab.mu.Unlock()
		result["ticket"] = ticket
		result["expires_at"] = expires.UTC().Format(time.RFC3339)
		result["ticket_expires_at"] = g.TicketExpires.UTC().Format(time.RFC3339)
		result["ws_url"] = s.collab.config.WSURL
		result["user"] = collaborationUser(ctx, g.AnonymousID)
		return result
	}).(shared.Row)
}
func (s *Service) collaborationGrant(id string) collaborationGrant {
	if s.collab == nil {
		shared.Fail(503, "协同服务未启用")
	}
	s.collab.mu.Lock()
	g, ok := s.collab.grants["auth:"+id]
	s.collab.mu.Unlock()
	if !ok || !time.Now().Before(g.Expires) {
		shared.Fail(401, "协同授权已过期，请重新连接")
	}
	return g
}
func (s *Service) grantContext(db *gorm.DB, ctx context.Context, g collaborationGrant) context.Context {
	if g.UserID != "" {
		user := repository.AuthUserForSession(db, g.UserID, g.SessionID)
		if user == nil {
			shared.Fail(401, "登录已失效，请重新连接")
		}
		return identity.WithUser(ctx, userDTO(user), g.SessionID)
	}
	return ctx
}
func (s *Service) authorizeGrant(db *gorm.DB, ctx context.Context, id, key string, write, content bool) (shared.Row, shared.Row, context.Context) {
	g := s.collaborationGrant(id)
	if g.FileKey != key {
		shared.Fail(403, "协同文档不匹配")
	}
	ctx = s.grantContext(db, ctx, g)
	doc, p := s.resolveCollaboration(db, ctx, key, g.Access, g.ShareToken, content)
	if write && !shared.Bool(p["write"]) {
		shared.Fail(403, "文档编辑权限已失效")
	}
	return doc, p, ctx
}
func (s *Service) AuthorizeCollaboration(ctx context.Context, ticket, id, key string) shared.Row {
	if s.collab == nil {
		shared.Fail(503, "协同服务未启用")
	}
	if ticket != "" {
		s.collab.mu.Lock()
		g, ok := s.collab.grants["ticket:"+shared.Digest(ticket)]
		delete(s.collab.grants, "ticket:"+shared.Digest(ticket))
		s.collab.mu.Unlock()
		if !ok || !time.Now().Before(g.TicketExpires) || g.FileKey != key {
			shared.Fail(401, "协同票据已失效")
		}
		id = shared.RandomToken(32)
		s.collab.mu.Lock()
		s.collab.grants["auth:"+id] = g
		s.collab.mu.Unlock()
	}
	return s.tx(ctx, false, func(db *gorm.DB) any {
		doc, p, principal := s.authorizeGrant(db, ctx, id, key, false, false)
		g := s.collaborationGrant(id)
		epoch := int64(1)
		if state := repository.CollaborationMetadata(db, doc["id"]); state != nil {
			epoch = state.Epoch
		}
		if g.Epoch != epoch {
			shared.Fail(409, "文档已被替换，请使用新票据重新加载")
		}
		result := s.addCollaborationMetadata(db, key, shared.Row{"authorization_id": id, "file_key": key, "document_name": key, "file_name": doc["file_name"], "permissions": p, "user": collaborationUser(principal, g.AnonymousID), "expires_at": g.Expires.UTC().Format(time.RFC3339)})
		return result
	}).(shared.Row)
}
func collaborationHash(value any) string {
	data, err := json.Marshal(value)
	shared.Must(err)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
