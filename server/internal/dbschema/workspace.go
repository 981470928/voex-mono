package dbschema

// WorkspaceStateTable 定义表名与物理字段。
type WorkspaceStateTable struct {
	Name    string
	Columns struct {
		ID string
	}
}

var WorkspaceState = func() WorkspaceStateTable {
	var table WorkspaceStateTable
	table.Name = "workspace_state"
	table.Columns.ID = "id"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (WorkspaceStateTable) As(alias string) WorkspaceStateTable {
	table := WorkspaceState
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (WorkspaceStateTable) Qualified() WorkspaceStateTable {
	table := WorkspaceState.As(WorkspaceState.Name)
	table.Name = WorkspaceState.Name
	return table
}

// ProjectsTable 定义表名与物理字段。
type ProjectsTable struct {
	Name    string
	Columns struct {
		ID          string
		PROJECT_KEY string
		NAME        string
		CREATED_AT  string
		UPDATED_AT  string
		CREATOR_ID  string
		TEAM_ID     string
		PRIVILEGES  string
	}
}

var Projects = func() ProjectsTable {
	var table ProjectsTable
	table.Name = "projects"
	table.Columns.ID = "id"
	table.Columns.PROJECT_KEY = "project_key"
	table.Columns.NAME = "name"
	table.Columns.CREATED_AT = "created_at"
	table.Columns.UPDATED_AT = "updated_at"
	table.Columns.CREATOR_ID = "creator_id"
	table.Columns.TEAM_ID = "team_id"
	table.Columns.PRIVILEGES = "privileges"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (ProjectsTable) As(alias string) ProjectsTable {
	table := Projects
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.PROJECT_KEY = alias + "." + table.Columns.PROJECT_KEY
	table.Columns.NAME = alias + "." + table.Columns.NAME
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	table.Columns.UPDATED_AT = alias + "." + table.Columns.UPDATED_AT
	table.Columns.CREATOR_ID = alias + "." + table.Columns.CREATOR_ID
	table.Columns.TEAM_ID = alias + "." + table.Columns.TEAM_ID
	table.Columns.PRIVILEGES = alias + "." + table.Columns.PRIVILEGES
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (ProjectsTable) Qualified() ProjectsTable {
	table := Projects.As(Projects.Name)
	table.Name = Projects.Name
	return table
}

// ProjectMembersTable 定义表名与物理字段。
type ProjectMembersTable struct {
	Name    string
	Columns struct {
		PROJECT_ID string
		USER_ID    string
	}
}

var ProjectMembers = func() ProjectMembersTable {
	var table ProjectMembersTable
	table.Name = "project_members"
	table.Columns.PROJECT_ID = "project_id"
	table.Columns.USER_ID = "user_id"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (ProjectMembersTable) As(alias string) ProjectMembersTable {
	table := ProjectMembers
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.PROJECT_ID = alias + "." + table.Columns.PROJECT_ID
	table.Columns.USER_ID = alias + "." + table.Columns.USER_ID
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (ProjectMembersTable) Qualified() ProjectMembersTable {
	table := ProjectMembers.As(ProjectMembers.Name)
	table.Name = ProjectMembers.Name
	return table
}

// FoldersTable 定义表名与物理字段。
type FoldersTable struct {
	Name    string
	Columns struct {
		ID         string
		FOLDER_KEY string
		PROJECT_ID string
		PARENT_ID  string
		NAME       string
		CREATED_AT string
		UPDATED_AT string
		PRIVILEGES string
		DELETED_AT string
		DELETED_BY string
		EXPIRES_AT string
	}
}

var Folders = func() FoldersTable {
	var table FoldersTable
	table.Name = "folders"
	table.Columns.ID = "id"
	table.Columns.FOLDER_KEY = "folder_key"
	table.Columns.PROJECT_ID = "project_id"
	table.Columns.PARENT_ID = "parent_id"
	table.Columns.NAME = "name"
	table.Columns.CREATED_AT = "created_at"
	table.Columns.UPDATED_AT = "updated_at"
	table.Columns.PRIVILEGES = "privileges"
	table.Columns.DELETED_AT = "deleted_at"
	table.Columns.DELETED_BY = "deleted_by"
	table.Columns.EXPIRES_AT = "expires_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (FoldersTable) As(alias string) FoldersTable {
	table := Folders
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.FOLDER_KEY = alias + "." + table.Columns.FOLDER_KEY
	table.Columns.PROJECT_ID = alias + "." + table.Columns.PROJECT_ID
	table.Columns.PARENT_ID = alias + "." + table.Columns.PARENT_ID
	table.Columns.NAME = alias + "." + table.Columns.NAME
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	table.Columns.UPDATED_AT = alias + "." + table.Columns.UPDATED_AT
	table.Columns.PRIVILEGES = alias + "." + table.Columns.PRIVILEGES
	table.Columns.DELETED_AT = alias + "." + table.Columns.DELETED_AT
	table.Columns.DELETED_BY = alias + "." + table.Columns.DELETED_BY
	table.Columns.EXPIRES_AT = alias + "." + table.Columns.EXPIRES_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (FoldersTable) Qualified() FoldersTable {
	table := Folders.As(Folders.Name)
	table.Name = Folders.Name
	return table
}
