package dbschema

// UsersTable 定义表名与物理字段。
type UsersTable struct {
	Name    string
	Columns struct {
		ID            string
		ACCOUNT       string
		PASSWORD_HASH string
		NAME          string
		AVATOR        string
		EMAIL         string
		PHONE         string
		CREATED_AT    string
		UPDATED_AT    string
		USER_CONFIG   string
	}
}

var Users = func() UsersTable {
	var table UsersTable
	table.Name = "users"
	table.Columns.ID = "id"
	table.Columns.ACCOUNT = "account"
	table.Columns.PASSWORD_HASH = "password_hash"
	table.Columns.NAME = "name"
	table.Columns.AVATOR = "avator"
	table.Columns.EMAIL = "email"
	table.Columns.PHONE = "phone"
	table.Columns.CREATED_AT = "created_at"
	table.Columns.UPDATED_AT = "updated_at"
	table.Columns.USER_CONFIG = "user_config"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (UsersTable) As(alias string) UsersTable {
	table := Users
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.ACCOUNT = alias + "." + table.Columns.ACCOUNT
	table.Columns.PASSWORD_HASH = alias + "." + table.Columns.PASSWORD_HASH
	table.Columns.NAME = alias + "." + table.Columns.NAME
	table.Columns.AVATOR = alias + "." + table.Columns.AVATOR
	table.Columns.EMAIL = alias + "." + table.Columns.EMAIL
	table.Columns.PHONE = alias + "." + table.Columns.PHONE
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	table.Columns.UPDATED_AT = alias + "." + table.Columns.UPDATED_AT
	table.Columns.USER_CONFIG = alias + "." + table.Columns.USER_CONFIG
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (UsersTable) Qualified() UsersTable {
	table := Users.As(Users.Name)
	table.Name = Users.Name
	return table
}

// AuthSessionsTable 定义表名与物理字段。
type AuthSessionsTable struct {
	Name    string
	Columns struct {
		ID           string
		USER_ID      string
		REFRESH_HASH string
		EXPIRES_AT   string
		CREATED_AT   string
	}
}

var AuthSessions = func() AuthSessionsTable {
	var table AuthSessionsTable
	table.Name = "auth_sessions"
	table.Columns.ID = "id"
	table.Columns.USER_ID = "user_id"
	table.Columns.REFRESH_HASH = "refresh_hash"
	table.Columns.EXPIRES_AT = "expires_at"
	table.Columns.CREATED_AT = "created_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (AuthSessionsTable) As(alias string) AuthSessionsTable {
	table := AuthSessions
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.USER_ID = alias + "." + table.Columns.USER_ID
	table.Columns.REFRESH_HASH = alias + "." + table.Columns.REFRESH_HASH
	table.Columns.EXPIRES_AT = alias + "." + table.Columns.EXPIRES_AT
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (AuthSessionsTable) Qualified() AuthSessionsTable {
	table := AuthSessions.As(AuthSessions.Name)
	table.Name = AuthSessions.Name
	return table
}
