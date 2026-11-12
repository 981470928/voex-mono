package repository

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"voex-server/internal/dbschema"
	"voex-server/internal/model"
	"voex-server/internal/shared"
)

// TeamForMember 返回成员有效角色，团队所有者优先于成员表中的角色。
func TeamForMember(db *gorm.DB, userID, key string) shared.Row {
	dt, memberDT := dbschema.Teams, dbschema.TeamMembers
	team := One(db.Table(dt.Name).Where(&model.Team{TeamKey: key}, dt.Columns.TEAM_KEY))
	if team == nil {
		return nil
	}
	member := One(
		db.Table(memberDT.Name).
			Select(dbschema.List(memberDT.Columns.USER_ID, memberDT.Columns.ROLE)).
			Where(memberDT.Columns.TEAM_ID+
				"=? AND "+
				memberDT.Columns.USER_ID+
				"=?", team[dt.Columns.ID], userID),
	)
	if member == nil {
		return nil
	}
	team["member_id"],
		team["role"] =
		member[memberDT.Columns.USER_ID],
		member[memberDT.Columns.ROLE]
	if shared.String(team[dt.Columns.OWNER_ID]) == shared.String(member[memberDT.Columns.USER_ID]) {
		team["role"] = "owner"
	}
	return team
}

func TeamListForUser(db *gorm.DB, userID string) []shared.Row {
	dt, memberDT := dbschema.Teams, dbschema.TeamMembers
	members := Rows(
		db.Table(memberDT.Name).
			Select(dbschema.List(
				memberDT.Columns.TEAM_ID,
				memberDT.Columns.USER_ID,
				memberDT.Columns.ROLE,
			)).
			Where(&model.TeamMember{UserID: userID}, memberDT.Columns.USER_ID),
	)
	if len(members) == 0 {
		return []shared.Row{}
	}
	membershipByTeam := make(map[string]shared.Row, len(members))
	for _, member := range members {
		membershipByTeam[shared.String(member[memberDT.Columns.TEAM_ID])] = member
	}
	// Keep ordering in one query, including the original nullable personal-owner expression.
	// 在同一条查询中完成排序，并保留原有可为 NULL 的个人所有者表达式。
	teamIDs := db.Table(memberDT.Name).
		Select(memberDT.Columns.TEAM_ID).
		Where(&model.TeamMember{UserID: userID}, memberDT.Columns.USER_ID)
	teams := Rows(db.Table(dt.Name).Where(dt.Columns.ID+" IN (?)", teamIDs).
		Clauses(clause.OrderBy{
			Expression: clause.Expr{
				SQL: "(" + dt.Columns.PERSONAL_OWNER_ID + "=?) DESC," + dbschema.List(
					dt.Columns.CREATED_AT,
					dt.Columns.ID,
				),
				Vars: []any{
					userID,
				},
			},
		}),
	)
	counts := rowsByKey(
		db.Table(memberDT.Name).
			Select(memberDT.Columns.TEAM_ID+",COUNT(*) AS member_count").
			Group(memberDT.Columns.TEAM_ID),
		memberDT.Columns.TEAM_ID,
		rowValues(teams, dt.Columns.ID),
	)
	result := make([]shared.Row, 0, len(teams))
	for _, team := range teams {
		key := shared.String(team[dt.Columns.ID])
		member := membershipByTeam[key]
		if member == nil {
			continue
		}
		team["role"] = member[memberDT.Columns.ROLE]
		if shared.String(
			team[dt.Columns.OWNER_ID],
		) == shared.String(
			member[memberDT.Columns.USER_ID],
		) {
			team["role"] = "owner"
		}
		team["member_count"] = int64(0)
		if count := counts[key]; count != nil {
			team["member_count"] = count["member_count"]
		}
		result = append(result, team)
	}
	return result
}

func TeamMemberCount(db *gorm.DB, teamID any) int64 {
	dt := dbschema.TeamMembers
	var count int64
	Must(db.Table(dt.Name).Where(dt.Columns.TEAM_ID+"=?", teamID).Count(&count))
	return count
}

func TeamByID(db *gorm.DB, id int64) shared.Row {
	dt := dbschema.Teams
	return One(db.Table(dt.Name).Where(&model.Team{ID: id}, dt.Columns.ID))
}

func TeamForPersonalOwner(db *gorm.DB, userID string) shared.Row {
	dt := dbschema.Teams
	return One(
		db.Table(dt.Name).
			Where(&model.Team{PersonalOwnerID: &userID}, dt.Columns.PERSONAL_OWNER_ID),
	)
}

func TeamInsert(db *gorm.DB, values shared.Row) (int64, error) {
	dt := dbschema.Teams
	if err := db.Table(dt.Name).Create(map[string]any(values)).Error; err != nil {
		return 0, err
	}
	row := One(
		db.Table(dt.Name).
			Select(dt.Columns.ID).
			Where(dt.Columns.TEAM_KEY+"=?", values[dt.Columns.TEAM_KEY]),
	)
	return shared.Int64(row[dt.Columns.ID]), nil
}

func TeamIdentifierConflict(err error) bool {
	return errors.Is(shared.DatabaseError(err), gorm.ErrDuplicatedKey)
}

func TeamInsertMember(db *gorm.DB, teamID any, userID string, ignoreExisting bool) {
	dt := dbschema.TeamMembers
	q := db.Table(dt.Name)
	if ignoreExisting {
		q = q.Clauses(clause.Insert{Modifier: "IGNORE"})
	}
	Must(
		q.Create(
			map[string]any{
				dt.Columns.TEAM_ID: teamID,
				dt.Columns.USER_ID: userID,
				dt.Columns.ROLE:    "member",
			},
		),
	)
}

func TeamRename(db *gorm.DB, teamID any, name string) {
	dt := dbschema.Teams
	Must(db.Table(dt.Name).Where(dt.Columns.ID+"=?", teamID).Update(dt.Columns.NAME, name))
}

func TeamHasProjects(db *gorm.DB, teamID any) bool {
	dt := dbschema.Projects
	return One(
		db.Table(dt.Name).Select(dt.Columns.ID).Where(dt.Columns.TEAM_ID+"=?", teamID).Limit(1),
	) != nil
}

func TeamDelete(db *gorm.DB, teamID any) {
	dt := dbschema.Teams
	Must(db.Table(dt.Name).Where(dt.Columns.ID+"=?", teamID).Delete(&map[string]any{}))
}

func TeamMembership(db *gorm.DB, teamID any, userID string) shared.Row {
	dt := dbschema.TeamMembers
	return One(
		db.Table(dt.Name).
			Where(dt.Columns.TEAM_ID+"=? AND "+dt.Columns.USER_ID+"=?", teamID, userID),
	)
}

func TeamMemberRole(db *gorm.DB, teamID any, userID, role string) {
	dt := dbschema.TeamMembers
	Must(
		db.Table(dt.Name).
			Where(dt.Columns.TEAM_ID+"=? AND "+dt.Columns.USER_ID+"=?", teamID, userID).
			Update(dt.Columns.ROLE, role),
	)
}

func TeamChangeOwner(db *gorm.DB, teamID any, userID string) {
	dt := dbschema.Teams
	Must(db.Table(dt.Name).Where(dt.Columns.ID+"=?", teamID).Update(dt.Columns.OWNER_ID, userID))
}

func TeamMembersList(db *gorm.DB, teamID any, ownerID string) []shared.Row {
	dt, userDT := dbschema.TeamMembers, dbschema.Users
	members := Rows(
		db.Table(dt.Name).
			Select(dbschema.List(dt.Columns.USER_ID, dt.Columns.ROLE, dt.Columns.JOINED_AT)).
			Where(dt.Columns.TEAM_ID+"=?", teamID).
			Clauses(clause.OrderBy{
				Expression: clause.Expr{
					SQL: "(" +
						dt.Columns.USER_ID +
						"=?) DESC,(" +
						dt.Columns.ROLE +
						"='admin') DESC," + dbschema.List(
						dt.Columns.JOINED_AT,
						dt.Columns.USER_ID,
					),
					Vars: []any{
						ownerID,
					},
				},
			}),
	)
	users := rowsByKey(
		db.Table(userDT.Name).
			Select(dbschema.List(userDT.Columns.ID, userDT.Columns.NAME, userDT.Columns.AVATOR)),
		userDT.Columns.ID,
		rowValues(members, dt.Columns.USER_ID),
	)
	result := make([]shared.Row, 0, len(members))
	for _, member := range members {
		user := users[shared.String(member[dt.Columns.USER_ID])]
		if user == nil {
			continue
		}
		role := member[dt.Columns.ROLE]
		if shared.String(user[userDT.Columns.ID]) == ownerID {
			role = "owner"
		}
		result = append(result, shared.Row{
			dt.Columns.USER_ID:    user[userDT.Columns.ID],
			userDT.Columns.NAME:   user[userDT.Columns.NAME],
			userDT.Columns.AVATOR: user[userDT.Columns.AVATOR],
			dt.Columns.ROLE:       role,
			dt.Columns.JOINED_AT:  member[dt.Columns.JOINED_AT],
		})
	}
	return result
}

func TeamRemoveMember(db *gorm.DB, teamID any, userID string) {
	projectDT, memberDT := dbschema.Projects, dbschema.ProjectMembers
	projects := db.Table(projectDT.Name).
		Select(projectDT.Columns.ID).
		Where(projectDT.Columns.TEAM_ID+"=?", teamID)
	Must(
		db.Table(memberDT.Name).
			Where(memberDT.Columns.PROJECT_ID+
				" IN (?) AND "+
				memberDT.Columns.USER_ID+
				"=?", projects, userID).
			Delete(&map[string]any{}),
	)
	dt := dbschema.TeamMembers
	Must(
		db.Table(dt.Name).
			Where(dt.Columns.TEAM_ID+"=? AND "+dt.Columns.USER_ID+"=?", teamID, userID).
			Delete(&map[string]any{}),
	)
}

func TeamInvitesList(db *gorm.DB, teamID any) []shared.Row {
	dt := dbschema.TeamInvites
	return Rows(
		db.Table(dt.Name).
			Select(dbschema.List(dt.Columns.ID, dt.Columns.CREATED_AT, dt.Columns.REVOKED_AT)).
			Where(dt.Columns.TEAM_ID+"=?", teamID).
			Order(dt.Columns.CREATED_AT + " DESC"),
	)
}

func TeamInsertInvite(db *gorm.DB, id string, teamID any, tokenHash, creatorID string) {
	dt := dbschema.TeamInvites
	Must(
		db.Table(dt.Name).
			Create(map[string]any{
				dt.Columns.ID:         id,
				dt.Columns.TEAM_ID:    teamID,
				dt.Columns.TOKEN_HASH: tokenHash,
				dt.Columns.CREATED_BY: creatorID,
			}),
	)
}

func TeamInviteByID(db *gorm.DB, teamID any, id string) shared.Row {
	dt := dbschema.TeamInvites
	return One(db.Table(dt.Name).Where(dt.Columns.ID+"=? AND "+dt.Columns.TEAM_ID+"=?", id, teamID))
}

func TeamRevokeInvite(db *gorm.DB, id string) {
	dt := dbschema.TeamInvites
	Must(
		db.Table(dt.Name).
			Where(&model.TeamInvite{ID: id}, dt.Columns.ID).
			Update(dt.Columns.REVOKED_AT, gorm.Expr(
				"COALESCE("+dt.Columns.REVOKED_AT+",CURRENT_TIMESTAMP())",
			)),
	)
}

func TeamByInvite(db *gorm.DB, tokenHash string) shared.Row {
	dt, inviteDT := dbschema.Teams, dbschema.TeamInvites
	qualifiedDT := dt.Qualified()
	return One(
		db.Table(dt.Name).
			Select(dbschema.List(
				qualifiedDT.Columns.ID,
				dt.Columns.TEAM_KEY,
				dt.Columns.TEAM_CODE,
				dt.Columns.NAME,
				dt.Columns.KIND,
			)).
			Joins("JOIN "+inviteDT.Name+" ON "+inviteDT.Columns.TEAM_ID+"="+qualifiedDT.Columns.ID).
			Where(inviteDT.Columns.TOKEN_HASH+
				"=? AND "+
				inviteDT.Columns.REVOKED_AT+
				" IS NULL", tokenHash),
	)
}

func TeamByCode(db *gorm.DB, code string) shared.Row {
	dt := dbschema.Teams
	return One(db.Table(dt.Name).Where(&model.Team{TeamCode: code}, dt.Columns.TEAM_CODE))
}

func teamRequestsQuery(db *gorm.DB) *gorm.DB {
	dt := dbschema.TeamJoinRequests
	return db.Table(dt.Name).
		Select(dbschema.List(
			dt.Columns.ID,
			dt.Columns.TEAM_ID,
			dt.Columns.USER_ID,
			dt.Columns.MESSAGE,
			dt.Columns.STATUS,
			dt.Columns.CREATED_AT,
			dt.Columns.REVIEWED_AT,
		))
}

func teamRequestRows(db *gorm.DB, query *gorm.DB) []shared.Row {
	dt, teamDT, userDT := dbschema.TeamJoinRequests, dbschema.Teams, dbschema.Users
	requests := Rows(query)
	teams := rowsByKey(
		db.Table(teamDT.Name).
			Select(dbschema.List(teamDT.Columns.ID, teamDT.Columns.TEAM_KEY, teamDT.Columns.NAME)),
		teamDT.Columns.ID,
		rowValues(requests, dt.Columns.TEAM_ID),
	)
	users := rowsByKey(
		db.Table(userDT.Name).Select(dbschema.List(userDT.Columns.ID, userDT.Columns.NAME)),
		userDT.Columns.ID,
		rowValues(requests, dt.Columns.USER_ID),
	)
	result := make([]shared.Row, 0, len(requests))
	for _, request := range requests {
		team := teams[shared.String(request[dt.Columns.TEAM_ID])]
		user := users[shared.String(request[dt.Columns.USER_ID])]
		if team == nil || user == nil {
			continue
		}
		request[teamDT.Columns.TEAM_KEY],
			request["team_name"],
			request[userDT.Columns.NAME] =
			team[teamDT.Columns.TEAM_KEY],
			team[teamDT.Columns.NAME],
			user[userDT.Columns.NAME]
		delete(request, dt.Columns.TEAM_ID)
		result = append(result, request)
	}
	return result
}

func TeamRequestResult(db *gorm.DB, id any) shared.Row {
	dt := dbschema.TeamJoinRequests
	rows := teamRequestRows(db, teamRequestsQuery(db).Where(dt.Columns.ID+"=?", id).Limit(1))
	if len(rows) == 0 {
		return nil
	}
	return rows[0]
}

func TeamRequestForUser(db *gorm.DB, teamID any, userID string) shared.Row {
	dt := dbschema.TeamJoinRequests
	return One(
		db.Table(dt.Name).
			Where(dt.Columns.TEAM_ID+"=? AND "+dt.Columns.USER_ID+"=?", teamID, userID),
	)
}

func TeamRequestByID(db *gorm.DB, teamID any, id string) shared.Row {
	dt := dbschema.TeamJoinRequests
	return One(db.Table(dt.Name).Where(dt.Columns.TEAM_ID+"=? AND "+dt.Columns.ID+"=?", teamID, id))
}

func TeamRequestsForUser(db *gorm.DB, userID string) []shared.Row {
	dt := dbschema.TeamJoinRequests
	return teamRequestRows(
		db,
		teamRequestsQuery(
			db,
		).Where(&model.TeamJoinRequest{UserID: userID}, dt.Columns.USER_ID).
			Order(dt.Columns.CREATED_AT+" DESC"),
	)
}

func TeamRequestsForTeam(db *gorm.DB, teamID any) []shared.Row {
	dt := dbschema.TeamJoinRequests
	return teamRequestRows(
		db,
		teamRequestsQuery(
			db,
		).Where(dt.Columns.TEAM_ID+"=?", teamID).
			Order("("+dt.Columns.STATUS+"='pending') DESC,"+dt.Columns.CREATED_AT+" DESC"),
	)
}

func TeamInsertRequest(db *gorm.DB, id string, teamID any, userID, message string) {
	dt := dbschema.TeamJoinRequests
	Must(
		db.Table(dt.Name).
			Create(map[string]any{
				dt.Columns.ID:      id,
				dt.Columns.TEAM_ID: teamID,
				dt.Columns.USER_ID: userID,
				dt.Columns.MESSAGE: message,
			}),
	)
}

func TeamReopenRequest(db *gorm.DB, priorID any, id, message string) {
	dt := dbschema.TeamJoinRequests
	Must(db.Table(dt.Name).Where(dt.Columns.ID+"=?", priorID).Updates(map[string]any{
		dt.Columns.ID:          id,
		dt.Columns.MESSAGE:     message,
		dt.Columns.STATUS:      "pending",
		dt.Columns.CREATED_AT:  gorm.Expr("CURRENT_TIMESTAMP()"),
		dt.Columns.REVIEWED_AT: nil,
		dt.Columns.REVIEWED_BY: nil,
	}))
}

func TeamReviewRequest(db *gorm.DB, id any, status, reviewerID string) {
	dt := dbschema.TeamJoinRequests
	Must(db.Table(dt.Name).Where(dt.Columns.ID+"=?", id).Updates(map[string]any{
		dt.Columns.STATUS:      status,
		dt.Columns.REVIEWED_BY: reviewerID,
		dt.Columns.REVIEWED_AT: gorm.Expr("CURRENT_TIMESTAMP()"),
	}))
}
