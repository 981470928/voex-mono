package repository

import (
	"errors"

	"github.com/go-sql-driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"voex-server/internal/shared"
)

// TeamForMember 返回成员有效角色，团队所有者优先于成员表中的角色。
func TeamForMember(db *gorm.DB, userID, key string) shared.Row {
	return One(db.Table("teams AS t").
		Select("t.*,m.user_id AS member_id,CASE WHEN t.owner_id=m.user_id THEN 'owner' ELSE m.role END AS role").
		Joins("JOIN team_members m ON m.team_id=t.id AND m.user_id=?", userID).
		Where("t.team_key=?", key))
}

func TeamListForUser(db *gorm.DB, userID string) []shared.Row {
	return Rows(db.Table("teams AS t").
		Select("t.*,CASE WHEN t.owner_id=m.user_id THEN 'owner' ELSE m.role END AS role,(SELECT COUNT(*) FROM team_members tm WHERE tm.team_id=t.id) AS member_count").
		Joins("JOIN team_members m ON m.team_id=t.id").Where("m.user_id=?", userID).
		Clauses(clause.OrderBy{Expression: clause.Expr{SQL: "(t.personal_owner_id=?) DESC,t.created_at,t.id", Vars: []any{userID}}}))
}

func TeamMemberCount(db *gorm.DB, teamID any) int64 {
	var count int64
	Must(db.Table("team_members").Where("team_id=?", teamID).Count(&count))
	return count
}

func TeamByID(db *gorm.DB, id int64) shared.Row {
	return One(db.Table("teams").Where("id=?", id))
}

func TeamForPersonalOwner(db *gorm.DB, userID string) shared.Row {
	return One(db.Table("teams").Where("personal_owner_id=?", userID))
}

func TeamInsert(db *gorm.DB, values shared.Row) (int64, error) {
	if err := db.Table("teams").Create(map[string]any(values)).Error; err != nil {
		return 0, err
	}
	row := One(db.Table("teams").Select("id").Where("team_key=?", values["team_key"]))
	return shared.Int64(row["id"]), nil
}

func TeamIdentifierConflict(err error) bool {
	var dbError *mysql.MySQLError
	return errors.Is(err, gorm.ErrDuplicatedKey) || (errors.As(err, &dbError) && dbError.Number == 1062)
}

func TeamInsertMember(db *gorm.DB, teamID any, userID string, ignoreExisting bool) {
	q := db.Table("team_members")
	if ignoreExisting {
		q = q.Clauses(clause.Insert{Modifier: "IGNORE"})
	}
	Must(q.Create(map[string]any{"team_id": teamID, "user_id": userID, "role": "member"}))
}

func TeamRename(db *gorm.DB, teamID any, name string) {
	Must(db.Table("teams").Where("id=?", teamID).Update("name", name))
}

func TeamHasProjects(db *gorm.DB, teamID any) bool {
	return One(db.Table("projects").Select("id").Where("team_id=?", teamID).Limit(1)) != nil
}

func TeamDelete(db *gorm.DB, teamID any) {
	Must(db.Table("teams").Where("id=?", teamID).Delete(&map[string]any{}))
}

func TeamMembership(db *gorm.DB, teamID any, userID string) shared.Row {
	return One(db.Table("team_members").Where("team_id=? AND user_id=?", teamID, userID))
}

func TeamMemberRole(db *gorm.DB, teamID any, userID, role string) {
	Must(db.Table("team_members").Where("team_id=? AND user_id=?", teamID, userID).Update("role", role))
}

func TeamChangeOwner(db *gorm.DB, teamID any, userID string) {
	Must(db.Table("teams").Where("id=?", teamID).Update("owner_id", userID))
}

func TeamMembersList(db *gorm.DB, teamID any, ownerID string) []shared.Row {
	return Rows(db.Table("team_members AS m").
		Select("u.id AS user_id,u.name,u.avator,CASE WHEN u.id=? THEN 'owner' ELSE m.role END AS role,m.joined_at", ownerID).
		Joins("JOIN users u ON u.id=m.user_id").Where("m.team_id=?", teamID).
		Clauses(clause.OrderBy{Expression: clause.Expr{SQL: "(u.id=?) DESC,(m.role='admin') DESC,m.joined_at,u.id", Vars: []any{ownerID}}}))
}

func TeamRemoveMember(db *gorm.DB, teamID any, userID string) {
	projects := db.Table("projects").Select("id").Where("team_id=?", teamID)
	Must(db.Table("project_members").Where("project_id IN (?) AND user_id=?", projects, userID).Delete(&map[string]any{}))
	Must(db.Table("team_members").Where("team_id=? AND user_id=?", teamID, userID).Delete(&map[string]any{}))
}

func TeamInvitesList(db *gorm.DB, teamID any) []shared.Row {
	return Rows(db.Table("team_invites").Select("id,created_at,revoked_at").Where("team_id=?", teamID).Order("created_at DESC"))
}

func TeamInsertInvite(db *gorm.DB, id string, teamID any, tokenHash, creatorID string) {
	Must(db.Table("team_invites").Create(map[string]any{"id": id, "team_id": teamID, "token_hash": tokenHash, "created_by": creatorID}))
}

func TeamInviteByID(db *gorm.DB, teamID any, id string) shared.Row {
	return One(db.Table("team_invites").Where("id=? AND team_id=?", id, teamID))
}

func TeamRevokeInvite(db *gorm.DB, id string) {
	Must(db.Table("team_invites").Where("id=?", id).Update("revoked_at", gorm.Expr("COALESCE(revoked_at,CURRENT_TIMESTAMP())")))
}

func TeamByInvite(db *gorm.DB, tokenHash string) shared.Row {
	return One(db.Table("teams AS t").Select("t.id,t.team_key,t.team_code,t.name,t.kind").
		Joins("JOIN team_invites i ON i.team_id=t.id").Where("i.token_hash=? AND i.revoked_at IS NULL", tokenHash))
}

func TeamByCode(db *gorm.DB, code string) shared.Row {
	return One(db.Table("teams").Where("team_code=?", code))
}

const teamRequestColumns = "r.id,t.team_key,t.name AS team_name,r.user_id,u.name,r.message,r.status,r.created_at,r.reviewed_at"

func teamRequestsQuery(db *gorm.DB) *gorm.DB {
	return db.Table("team_join_requests AS r").Select(teamRequestColumns).
		Joins("JOIN teams t ON t.id=r.team_id").Joins("JOIN users u ON u.id=r.user_id")
}

func TeamRequestResult(db *gorm.DB, id any) shared.Row {
	return One(teamRequestsQuery(db).Where("r.id=?", id))
}

func TeamRequestForUser(db *gorm.DB, teamID any, userID string) shared.Row {
	return One(db.Table("team_join_requests").Where("team_id=? AND user_id=?", teamID, userID))
}

func TeamRequestByID(db *gorm.DB, teamID any, id string) shared.Row {
	return One(db.Table("team_join_requests").Where("team_id=? AND id=?", teamID, id))
}

func TeamRequestsForUser(db *gorm.DB, userID string) []shared.Row {
	return Rows(teamRequestsQuery(db).Where("r.user_id=?", userID).Order("r.created_at DESC"))
}

func TeamRequestsForTeam(db *gorm.DB, teamID any) []shared.Row {
	return Rows(teamRequestsQuery(db).Where("r.team_id=?", teamID).Order("(r.status='pending') DESC,r.created_at DESC"))
}

func TeamInsertRequest(db *gorm.DB, id string, teamID any, userID, message string) {
	Must(db.Table("team_join_requests").Create(map[string]any{"id": id, "team_id": teamID, "user_id": userID, "message": message}))
}

func TeamReopenRequest(db *gorm.DB, priorID any, id, message string) {
	Must(db.Table("team_join_requests").Where("id=?", priorID).Updates(map[string]any{
		"id": id, "message": message, "status": "pending", "created_at": gorm.Expr("CURRENT_TIMESTAMP()"), "reviewed_at": nil, "reviewed_by": nil,
	}))
}

func TeamReviewRequest(db *gorm.DB, id any, status, reviewerID string) {
	Must(db.Table("team_join_requests").Where("id=?", id).Updates(map[string]any{
		"status": status, "reviewed_by": reviewerID, "reviewed_at": gorm.Expr("CURRENT_TIMESTAMP()"),
	}))
}
