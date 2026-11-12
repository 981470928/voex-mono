package dbschema

// TeamsTable 定义表名与物理字段。
type TeamsTable struct {
	Name    string
	Columns struct {
		ID                string
		TEAM_KEY          string
		TEAM_CODE         string
		NAME              string
		KIND              string
		OWNER_ID          string
		PERSONAL_OWNER_ID string
		PRIVILEGES        string
		CREATED_AT        string
		UPDATED_AT        string
	}
}

var Teams = func() TeamsTable {
	var table TeamsTable
	table.Name = "teams"
	table.Columns.ID = "id"
	table.Columns.TEAM_KEY = "team_key"
	table.Columns.TEAM_CODE = "team_code"
	table.Columns.NAME = "name"
	table.Columns.KIND = "kind"
	table.Columns.OWNER_ID = "owner_id"
	table.Columns.PERSONAL_OWNER_ID = "personal_owner_id"
	table.Columns.PRIVILEGES = "privileges"
	table.Columns.CREATED_AT = "created_at"
	table.Columns.UPDATED_AT = "updated_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (TeamsTable) As(alias string) TeamsTable {
	table := Teams
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.TEAM_KEY = alias + "." + table.Columns.TEAM_KEY
	table.Columns.TEAM_CODE = alias + "." + table.Columns.TEAM_CODE
	table.Columns.NAME = alias + "." + table.Columns.NAME
	table.Columns.KIND = alias + "." + table.Columns.KIND
	table.Columns.OWNER_ID = alias + "." + table.Columns.OWNER_ID
	table.Columns.PERSONAL_OWNER_ID = alias + "." + table.Columns.PERSONAL_OWNER_ID
	table.Columns.PRIVILEGES = alias + "." + table.Columns.PRIVILEGES
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	table.Columns.UPDATED_AT = alias + "." + table.Columns.UPDATED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (TeamsTable) Qualified() TeamsTable {
	table := Teams.As(Teams.Name)
	table.Name = Teams.Name
	return table
}

// TeamMembersTable 定义表名与物理字段。
type TeamMembersTable struct {
	Name    string
	Columns struct {
		TEAM_ID   string
		USER_ID   string
		ROLE      string
		JOINED_AT string
	}
}

var TeamMembers = func() TeamMembersTable {
	var table TeamMembersTable
	table.Name = "team_members"
	table.Columns.TEAM_ID = "team_id"
	table.Columns.USER_ID = "user_id"
	table.Columns.ROLE = "role"
	table.Columns.JOINED_AT = "joined_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (TeamMembersTable) As(alias string) TeamMembersTable {
	table := TeamMembers
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.TEAM_ID = alias + "." + table.Columns.TEAM_ID
	table.Columns.USER_ID = alias + "." + table.Columns.USER_ID
	table.Columns.ROLE = alias + "." + table.Columns.ROLE
	table.Columns.JOINED_AT = alias + "." + table.Columns.JOINED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (TeamMembersTable) Qualified() TeamMembersTable {
	table := TeamMembers.As(TeamMembers.Name)
	table.Name = TeamMembers.Name
	return table
}

// TeamInvitesTable 定义表名与物理字段。
type TeamInvitesTable struct {
	Name    string
	Columns struct {
		ID         string
		TEAM_ID    string
		TOKEN_HASH string
		CREATED_BY string
		CREATED_AT string
		REVOKED_AT string
	}
}

var TeamInvites = func() TeamInvitesTable {
	var table TeamInvitesTable
	table.Name = "team_invites"
	table.Columns.ID = "id"
	table.Columns.TEAM_ID = "team_id"
	table.Columns.TOKEN_HASH = "token_hash"
	table.Columns.CREATED_BY = "created_by"
	table.Columns.CREATED_AT = "created_at"
	table.Columns.REVOKED_AT = "revoked_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (TeamInvitesTable) As(alias string) TeamInvitesTable {
	table := TeamInvites
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.TEAM_ID = alias + "." + table.Columns.TEAM_ID
	table.Columns.TOKEN_HASH = alias + "." + table.Columns.TOKEN_HASH
	table.Columns.CREATED_BY = alias + "." + table.Columns.CREATED_BY
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	table.Columns.REVOKED_AT = alias + "." + table.Columns.REVOKED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (TeamInvitesTable) Qualified() TeamInvitesTable {
	table := TeamInvites.As(TeamInvites.Name)
	table.Name = TeamInvites.Name
	return table
}

// TeamJoinRequestsTable 定义表名与物理字段。
type TeamJoinRequestsTable struct {
	Name    string
	Columns struct {
		ID          string
		TEAM_ID     string
		USER_ID     string
		MESSAGE     string
		STATUS      string
		REVIEWED_BY string
		CREATED_AT  string
		REVIEWED_AT string
	}
}

var TeamJoinRequests = func() TeamJoinRequestsTable {
	var table TeamJoinRequestsTable
	table.Name = "team_join_requests"
	table.Columns.ID = "id"
	table.Columns.TEAM_ID = "team_id"
	table.Columns.USER_ID = "user_id"
	table.Columns.MESSAGE = "message"
	table.Columns.STATUS = "status"
	table.Columns.REVIEWED_BY = "reviewed_by"
	table.Columns.CREATED_AT = "created_at"
	table.Columns.REVIEWED_AT = "reviewed_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (TeamJoinRequestsTable) As(alias string) TeamJoinRequestsTable {
	table := TeamJoinRequests
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.TEAM_ID = alias + "." + table.Columns.TEAM_ID
	table.Columns.USER_ID = alias + "." + table.Columns.USER_ID
	table.Columns.MESSAGE = alias + "." + table.Columns.MESSAGE
	table.Columns.STATUS = alias + "." + table.Columns.STATUS
	table.Columns.REVIEWED_BY = alias + "." + table.Columns.REVIEWED_BY
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	table.Columns.REVIEWED_AT = alias + "." + table.Columns.REVIEWED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (TeamJoinRequestsTable) Qualified() TeamJoinRequestsTable {
	table := TeamJoinRequests.As(TeamJoinRequests.Name)
	table.Name = TeamJoinRequests.Name
	return table
}
