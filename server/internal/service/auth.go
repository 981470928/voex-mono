package service

import (
	"context"
	driver "github.com/go-sql-driver/mysql"
	"gorm.io/gorm"
	"regexp"
	"strings"
	"voex-server/internal/identity"
	"voex-server/internal/model"
	"voex-server/internal/repository"
	"voex-server/internal/shared"
)

var refreshPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var avatarPattern = regexp.MustCompile(`^/api/assets/([a-f0-9-]{36})$`)
var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
var phonePattern = regexp.MustCompile(`^\+?[0-9 ()-]{5,32}$`)

type Session struct {
	AccessToken  string     `json:"accessToken"`
	ExpiresIn    int        `json:"expiresIn"`
	User         shared.Row `json:"user"`
	RefreshToken string     `json:"-"`
}

func (s *Service) Authenticate(ctx context.Context, token string, optional bool) context.Context {
	if token == "" {
		if optional {
			return ctx
		}
		shared.Fail(401, "请先登录")
	}
	claims, ok := s.verifyAccess(token, false)
	if !ok {
		if optional {
			return ctx
		}
		shared.Fail(401, "登录已过期，请重新登录")
	}
	row := repository.AuthUserForSession(s.db.WithContext(ctx), shared.String(claims["sub"]), shared.String(claims["sid"]))
	if row == nil {
		if optional {
			return ctx
		}
		shared.Fail(401, "登录已失效，请重新登录")
	}
	return identity.WithUser(ctx, userDTO(row), shared.String(claims["sid"]))
}
func (s *Service) issueAccess(user shared.Row, id string) Session {
	return Session{AccessToken: s.signAccess(user, id), ExpiresIn: accessSeconds, User: user}
}
func (s *Service) createSession(db *gorm.DB, user shared.Row) Session {
	id, refresh := shared.UUID(), shared.RandomToken(32)
	repository.AuthDeleteExpired(db)
	repository.AuthCreateSession(db, id, shared.String(user["id"]), shared.Digest(refresh))
	session := s.issueAccess(user, id)
	session.RefreshToken = refresh
	return session
}
func (s *Service) AccountAvailable(ctx context.Context, account any) bool {
	return repository.AuthUserByAccount(s.db.WithContext(ctx), shared.Characters(account, "账号", 8, 64)) == nil
}
func (s *Service) Register(ctx context.Context, input shared.Row) Session {
	account := shared.Characters(input["account"], "账号", 8, 64)
	password := shared.Characters(input["password"], "密码", 10, 128)
	profile := profileValues(input)
	id := shared.UUID()
	var hash string
	s.hashSlot(func() { hash = hashPassword(password) })
	defer func() {
		if e := recover(); e != nil {
			if dbErr, ok := e.(*driver.MySQLError); ok && dbErr.Number == 1062 {
				shared.Fail(409, "账号已被使用，请更换账号")
			}
			panic(e)
		}
	}()
	return s.tx(ctx, true, func(tx *gorm.DB) any {
		repository.AuthCreateUser(tx, &model.User{ID: id, Account: []byte(account), PasswordHash: hash, Name: shared.String(profile["name"]), Email: shared.String(profile["email"]), Phone: shared.String(profile["phone"])})
		s.EnsurePersonalTeam(tx, id, shared.String(profile["name"]))
		return s.createSession(tx, shared.Row{"id": id, "account": account, "name": profile["name"], "email": profile["email"], "phone": profile["phone"], "avator": ""})
	}).(Session)
}
func (s *Service) Login(ctx context.Context, input shared.Row, previousRefresh string) Session {
	account := shared.Characters(input["account"], "账号", 8, 64)
	password := shared.Characters(input["password"], "密码", 10, 128)
	db := s.db.WithContext(ctx)
	row := repository.AuthUserByAccount(db, account)
	hash := s.dummyHash
	if row != nil {
		hash = shared.String(row["password_hash"])
	}
	valid := false
	s.hashSlot(func() { valid = verifyPassword(hash, password) })
	if row == nil || !valid {
		shared.Fail(401, "账号或密码不正确")
	}
	return s.txEvent(ctx, "permissions", "", func(tx *gorm.DB) any {
		if previousRefresh != "" {
			repository.AuthRevokeRefresh(tx, shared.Digest(previousRefresh))
		}
		return s.createSession(tx, userDTO(row))
	}).(Session)
}
func (s *Service) Refresh(ctx context.Context, token string) Session {
	if !refreshPattern.MatchString(token) {
		shared.Fail(401, "请重新登录")
	}
	row := repository.AuthUserForRefresh(s.db.WithContext(ctx), shared.Digest(token))
	if row == nil {
		shared.Fail(401, "登录已过期，请重新登录")
	}
	return s.issueAccess(userDTO(row), shared.String(row["session_id"]))
}
func (s *Service) Logout(ctx context.Context, access, refresh string) {
	s.txEvent(ctx, "permissions", "", func(db *gorm.DB) any {
		if p, ok := s.verifyAccess(access, true); ok {
			repository.AuthRevokeAccess(db, shared.String(p["sid"]), shared.String(p["sub"]))
		}
		if refresh != "" {
			repository.AuthRevokeRefresh(db, shared.Digest(refresh))
		}
		return nil
	})
}
func (s *Service) UpdateProfile(ctx context.Context, input shared.Row) shared.Row {
	user := identity.User(ctx)
	merged := shared.Row{}
	for k, v := range user {
		merged[k] = v
	}
	for k, v := range input {
		merged[k] = v
	}
	profile := profileValues(merged)
	avatar := shared.String(user["avator"])
	if value, exists := input["avator"]; exists {
		var ok bool
		avatar, ok = value.(string)
		if !ok {
			shared.Fail(400, "头像格式错误")
		}
		if avatar != "" {
			match := avatarPattern.FindStringSubmatch(avatar)
			if match == nil {
				shared.Fail(400, "请先上传头像")
			}
			if repository.AuthAvatar(s.db.WithContext(ctx), match[1], shared.String(user["id"])) == nil {
				shared.Fail(400, "头像文件不存在或不属于当前账号")
			}
		}
	}
	repository.AuthUpdateProfile(s.db.WithContext(ctx), shared.String(user["id"]), map[string]any{"name": profile["name"], "email": profile["email"], "phone": profile["phone"], "avator": avatar})
	result := shared.Row{}
	for k, v := range user {
		result[k] = v
	}
	for k, v := range profile {
		result[k] = v
	}
	result["avator"] = avatar
	return result
}
func profileValues(b shared.Row) shared.Row {
	name, ok := b["name"].(string)
	if !ok {
		shared.Fail(400, "请填写昵称")
	}
	name = shared.Characters(strings.TrimSpace(name), "昵称", 1, 64)
	email, phone := b["email"], b["phone"]
	if email == nil {
		email = ""
	}
	if phone == nil {
		phone = ""
	}
	e := strings.TrimSpace(shared.Characters(email, "邮箱", 0, 254))
	p := strings.TrimSpace(shared.Characters(phone, "手机号", 0, 32))
	if e != "" && !emailPattern.MatchString(e) {
		shared.Fail(400, "请输入有效的邮箱地址")
	}
	if p != "" && !phonePattern.MatchString(p) {
		shared.Fail(400, "请输入有效的手机号")
	}
	return shared.Row{"name": name, "email": e, "phone": p}
}
func userDTO(row shared.Row) shared.Row {
	v := shared.Row{}
	for _, k := range []string{"id", "account", "name", "avator", "email", "phone"} {
		v[k] = shared.String(row[k])
	}
	return v
}
