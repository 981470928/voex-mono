package service

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"
)

var teamInviteTokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var teamCodePattern = regexp.MustCompile(`^[0-9]{10}$`)

func (s *Service) teamRow(db *gorm.DB, ctx context.Context, key string, manager bool) shared.Row {
	team := repository.TeamForMember(db, shared.String(identity.User(ctx)["id"]), key)
	if team == nil {
		shared.Fail(404, "团队不存在或尚未加入")
	}
	if manager && shared.String(team["role"]) == "member" {
		shared.Fail(403, "只有团队所有者和管理员可以操作")
	}
	return team
}

func teamDTO(row shared.Row) shared.Row {
	role, kind := shared.String(row["role"]), shared.String(row["kind"])
	count := int64(1)
	if row["member_count"] != nil {
		count = shared.Int64(row["member_count"])
	}
	ownerStandard := role == "owner" && kind == "standard"
	return shared.Row{
		"team_key": row["team_key"], "team_code": row["team_code"], "name": row["name"],
		"kind": kind, "role": role, "owner_id": row["owner_id"], "member_count": count,
		"created_at": shared.Timestamp(row["created_at"]), "privileges": shared.Row{"mode": "members"},
		"permissions": shared.Row{"read": true, "write": true, "create_project": role == "owner" || role == "admin", "manage": role == "owner" || role == "admin", "transfer": ownerStandard, "delete": ownerStandard},
	}
}

func (s *Service) getTeam(db *gorm.DB, ctx context.Context, key string) shared.Row {
	row := s.teamRow(db, ctx, key, false)
	row["member_count"] = repository.TeamMemberCount(db, row["id"])
	return teamDTO(row)
}

func teamNumber() string {
	first, err := rand.Int(rand.Reader, big.NewInt(9))
	shared.Must(err)
	rest, err := rand.Int(rand.Reader, big.NewInt(1000000000))
	shared.Must(err)
	return fmt.Sprintf("%d%09d", first.Int64()+1, rest.Int64())
}

func (s *Service) insertTeam(db *gorm.DB, userID, name string, personal bool) int64 {
	kind := "standard"
	var personalOwner any
	if personal {
		kind, personalOwner = "personal", userID
	}
	for attempt := 0; attempt < 8; attempt++ {
		id, err := repository.TeamInsert(db, shared.Row{
			"team_key": shared.PublicKey(), "team_code": teamNumber(), "name": name,
			"kind": kind, "owner_id": userID, "personal_owner_id": personalOwner,
			"privileges": `{"mode":"members"}`,
		})
		if err != nil {
			if !repository.TeamIdentifierConflict(err) {
				shared.Must(err)
			}
			if personal {
				existing := repository.TeamForPersonalOwner(db, userID)
				if existing != nil {
					return shared.Int64(existing["id"])
				}
			}
			continue
		}
		repository.TeamInsertMember(db, id, userID, false)
		return id
	}
	panic("Unable to allocate unique team identifier")
}

func (s *Service) EnsurePersonalTeam(db *gorm.DB, userID, name string) int64 {
	row := repository.TeamForPersonalOwner(db, userID)
	if row != nil {
		return shared.Int64(row["id"])
	}
	return s.insertTeam(db, userID, name+"的个人团队", true)
}

func (s *Service) SelectedTeam(db *gorm.DB, ctx context.Context, key string) shared.Row {
	if key != "" {
		return s.teamRow(db, ctx, key, false)
	}
	row := repository.TeamForPersonalOwner(db, shared.String(identity.User(ctx)["id"]))
	if row == nil {
		shared.Fail(409, "个人团队尚未初始化")
	}
	return s.teamRow(db, ctx, shared.String(row["team_key"]), false)
}

func teamTimestamps(row shared.Row, fields ...string) shared.Row {
	for _, field := range fields {
		if row[field] != nil {
			row[field] = shared.Timestamp(row[field])
		}
	}
	return row
}

func teamRequestResult(db *gorm.DB, id any) shared.Row {
	return teamTimestamps(repository.TeamRequestResult(db, id), "created_at", "reviewed_at")
}

func (s *Service) InspectTeamInvite(ctx context.Context, value any) shared.Row {
	token, ok := value.(string)
	if !ok || !teamInviteTokenPattern.MatchString(token) {
		shared.Fail(404, "邀请链接无效或已撤销")
	}
	row := repository.TeamByInvite(s.db.WithContext(ctx), shared.Digest(token))
	if row == nil {
		shared.Fail(404, "邀请链接无效或已撤销")
	}
	return shared.Row{"team_key": row["team_key"], "team_code": row["team_code"], "name": row["name"], "kind": row["kind"]}
}

func (s *Service) ListTeams(ctx context.Context) []shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		rows := repository.TeamListForUser(db, shared.String(identity.User(ctx)["id"]))
		result := make([]shared.Row, 0, len(rows))
		for _, row := range rows {
			result = append(result, teamDTO(row))
		}
		return result
	}).([]shared.Row)
}

func (s *Service) CreateTeam(ctx context.Context, value any) shared.Row {
	return s.tx(ctx, true, func(db *gorm.DB) any {
		name := shared.Name(value, "团队名称")
		if utf8.RuneCountInString(name) > 128 {
			shared.Fail(400, "团队名称最多128个字符")
		}
		id := s.insertTeam(db, shared.String(identity.User(ctx)["id"]), name, false)
		return s.getTeam(db, ctx, shared.String(repository.TeamByID(db, id)["team_key"]))
	}).(shared.Row)
}

func (s *Service) GetTeam(ctx context.Context, key string) shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any { return s.getTeam(db, ctx, shared.Key(key, "团队标识")) }).(shared.Row)
}

func (s *Service) UpdateTeam(ctx context.Context, key string, value any) shared.Row {
	return s.tx(ctx, true, func(db *gorm.DB) any {
		team := s.teamRow(db, ctx, key, true)
		name := shared.Name(value, "团队名称")
		if utf8.RuneCountInString(name) > 128 {
			shared.Fail(400, "团队名称最多128个字符")
		}
		repository.TeamRename(db, team["id"], name)
		return s.getTeam(db, ctx, shared.String(team["team_key"]))
	}).(shared.Row)
}

func (s *Service) DeleteTeam(ctx context.Context, key string) {
	s.txEvent(ctx, "permissions", "", func(db *gorm.DB) any {
		team := s.teamRow(db, ctx, key, true)
		if shared.String(team["role"]) != "owner" {
			shared.Fail(403, "只有所有者可以删除团队")
		}
		if shared.String(team["kind"]) == "personal" {
			shared.Fail(403, "个人团队无法删除")
		}
		if repository.TeamHasProjects(db, team["id"]) {
			shared.Fail(409, "请先清空团队中的项目")
		}
		repository.TeamDelete(db, team["id"])
		return nil
	})
}

func (s *Service) TransferTeam(ctx context.Context, key string, value any) {
	s.txEvent(ctx, "permissions", "", func(db *gorm.DB) any {
		team := s.teamRow(db, ctx, key, true)
		if shared.String(team["role"]) != "owner" || shared.String(team["kind"]) == "personal" {
			shared.Fail(403, "仅普通团队的所有者可以转让团队")
		}
		userID := shared.Key(value, "成员标识")
		if userID == shared.String(team["owner_id"]) {
			shared.Fail(400, "请选择其他团队成员")
		}
		if repository.TeamMembership(db, team["id"], userID) == nil {
			shared.Fail(400, "新所有者必须是当前团队成员")
		}
		repository.TeamMemberRole(db, team["id"], shared.String(team["owner_id"]), "admin")
		repository.TeamChangeOwner(db, team["id"], userID)
		return nil
	})
}

func (s *Service) TeamMembers(ctx context.Context, key string) []shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		team := s.teamRow(db, ctx, key, false)
		rows := repository.TeamMembersList(db, team["id"], shared.String(team["owner_id"]))
		for _, row := range rows {
			teamTimestamps(row, "joined_at")
		}
		return rows
	}).([]shared.Row)
}

func (s *Service) UpdateTeamMember(ctx context.Context, key, userID string, value any) {
	s.txEvent(ctx, "permissions", "", func(db *gorm.DB) any {
		team := s.teamRow(db, ctx, key, true)
		if shared.String(team["role"]) != "owner" {
			shared.Fail(403, "只有所有者可以设置管理员")
		}
		if userID == shared.String(team["owner_id"]) {
			shared.Fail(403, "所有者身份只能通过团队转让变更")
		}
		role := shared.String(value)
		if role != "admin" && role != "member" {
			shared.Fail(400, "角色只能为管理员或成员")
		}
		if repository.TeamMembership(db, team["id"], userID) == nil {
			shared.Fail(404, "成员不存在")
		}
		repository.TeamMemberRole(db, team["id"], userID, role)
		return nil
	})
}

func (s *Service) RemoveTeamMember(ctx context.Context, key, userID string) {
	s.txEvent(ctx, "permissions", "", func(db *gorm.DB) any {
		team := s.teamRow(db, ctx, key, false)
		actorID := shared.String(identity.User(ctx)["id"])
		if userID == "me" {
			userID = actorID
		}
		member := repository.TeamMembership(db, team["id"], userID)
		if member == nil {
			shared.Fail(404, "成员不存在")
		}
		if userID == shared.String(team["owner_id"]) {
			shared.Fail(403, "所有者不能退出或被移除，请先转让普通团队")
		}
		role := shared.String(team["role"])
		if userID != actorID && (role == "member" || (role == "admin" && shared.String(member["role"]) == "admin")) {
			shared.Fail(403, "没有移除此成员的权限")
		}
		repository.TeamRemoveMember(db, team["id"], userID)
		return nil
	})
}

func (s *Service) TeamInvites(ctx context.Context, key string) []shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		team := s.teamRow(db, ctx, key, true)
		rows := repository.TeamInvitesList(db, team["id"])
		for _, row := range rows {
			teamTimestamps(row, "created_at", "revoked_at")
		}
		return rows
	}).([]shared.Row)
}

func (s *Service) CreateTeamInvite(ctx context.Context, key string) shared.Row {
	return s.tx(ctx, true, func(db *gorm.DB) any {
		team := s.teamRow(db, ctx, key, true)
		id, token := shared.UUID(), shared.RandomToken(32)
		repository.TeamInsertInvite(db, id, team["id"], shared.Digest(token), shared.String(identity.User(ctx)["id"]))
		return shared.Row{"id": id, "token": token, "created_at": shared.Timestamp(time.Now().UTC())}
	}).(shared.Row)
}

func (s *Service) RevokeTeamInvite(ctx context.Context, key, id string) {
	s.tx(ctx, true, func(db *gorm.DB) any {
		team := s.teamRow(db, ctx, key, true)
		if repository.TeamInviteByID(db, team["id"], id) == nil {
			shared.Fail(404, "邀请不存在")
		}
		repository.TeamRevokeInvite(db, id)
		return nil
	})
}

func (s *Service) RequestTeamJoin(ctx context.Context, b shared.Row) shared.Row {
	user := identity.User(ctx)
	message, ok := b["message"].(string)
	if !ok || strings.TrimSpace(message) == "" {
		shared.Fail(400, "请填写申请信息")
	}
	message = strings.TrimSpace(message)
	if utf8.RuneCountInString(message) > 1000 {
		shared.Fail(400, "申请信息最多1000个字符")
	}
	return s.tx(ctx, true, func(db *gorm.DB) any {
		var team shared.Row
		token, isToken := b["invite_token"].(string)
		code, isCode := b["team_code"].(string)
		if isToken && teamInviteTokenPattern.MatchString(token) {
			team = repository.TeamByInvite(db, shared.Digest(token))
		} else if isCode && teamCodePattern.MatchString(code) {
			team = repository.TeamByCode(db, code)
		} else {
			shared.Fail(400, "请提供有效的团队编号或邀请链接")
		}
		if team == nil {
			shared.Fail(404, "团队或邀请链接不存在")
		}
		teamID, userID := team["id"], shared.String(user["id"])
		if repository.TeamMembership(db, teamID, userID) != nil {
			shared.Fail(409, "你已经是该团队成员")
		}
		prior := repository.TeamRequestForUser(db, teamID, userID)
		if prior != nil && shared.String(prior["status"]) == "pending" {
			return teamRequestResult(db, prior["id"])
		}
		id := shared.UUID()
		if prior != nil {
			repository.TeamReopenRequest(db, prior["id"], id, message)
		} else {
			repository.TeamInsertRequest(db, id, teamID, userID, message)
		}
		return teamRequestResult(db, id)
	}).(shared.Row)
}

func (s *Service) MyTeamJoinRequests(ctx context.Context) []shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		rows := repository.TeamRequestsForUser(db, shared.String(identity.User(ctx)["id"]))
		for _, row := range rows {
			teamTimestamps(row, "created_at", "reviewed_at")
		}
		return rows
	}).([]shared.Row)
}

func (s *Service) TeamJoinRequests(ctx context.Context, key string) []shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		team := s.teamRow(db, ctx, key, true)
		rows := repository.TeamRequestsForTeam(db, team["id"])
		for _, row := range rows {
			teamTimestamps(row, "created_at", "reviewed_at")
		}
		return rows
	}).([]shared.Row)
}

func (s *Service) ReviewTeamJoinRequest(ctx context.Context, key, id string, value any) shared.Row {
	status := shared.String(value)
	if status != "approved" && status != "rejected" {
		shared.Fail(400, "审核结果不合法")
	}
	return s.tx(ctx, true, func(db *gorm.DB) any {
		team := s.teamRow(db, ctx, key, true)
		request := repository.TeamRequestByID(db, team["id"], id)
		if request == nil {
			shared.Fail(404, "申请不存在")
		}
		if shared.String(request["status"]) != "pending" {
			if shared.String(request["status"]) == status {
				return teamRequestResult(db, request["id"])
			}
			shared.Fail(409, "申请已经处理")
		}
		if status == "approved" {
			repository.TeamInsertMember(db, team["id"], shared.String(request["user_id"]), true)
		}
		repository.TeamReviewRequest(db, request["id"], status, shared.String(identity.User(ctx)["id"]))
		return teamRequestResult(db, request["id"])
	}).(shared.Row)
}
