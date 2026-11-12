package dbschema

// AssetsTable 定义表名与物理字段。
type AssetsTable struct {
	Name    string
	Columns struct {
		ID           string
		CREATOR_ID   string
		DIRECTORY    string
		STORAGE_NAME string
		NAME         string
		MIME         string
		SIZE         string
		CREATED_AT   string
	}
}

var Assets = func() AssetsTable {
	var table AssetsTable
	table.Name = "assets"
	table.Columns.ID = "id"
	table.Columns.CREATOR_ID = "creator_id"
	table.Columns.DIRECTORY = "directory"
	table.Columns.STORAGE_NAME = "storage_name"
	table.Columns.NAME = "name"
	table.Columns.MIME = "mime"
	table.Columns.SIZE = "size"
	table.Columns.CREATED_AT = "created_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (AssetsTable) As(alias string) AssetsTable {
	table := Assets
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.CREATOR_ID = alias + "." + table.Columns.CREATOR_ID
	table.Columns.DIRECTORY = alias + "." + table.Columns.DIRECTORY
	table.Columns.STORAGE_NAME = alias + "." + table.Columns.STORAGE_NAME
	table.Columns.NAME = alias + "." + table.Columns.NAME
	table.Columns.MIME = alias + "." + table.Columns.MIME
	table.Columns.SIZE = alias + "." + table.Columns.SIZE
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (AssetsTable) Qualified() AssetsTable {
	table := Assets.As(Assets.Name)
	table.Name = Assets.Name
	return table
}

// FilesTable 定义表名与物理字段。
type FilesTable struct {
	Name    string
	Columns struct {
		ID         string
		FILE_KEY   string
		HASH       string
		NAME       string
		MIME       string
		SIZE       string
		CREATED_AT string
		CREATOR_ID string
		PRIVILEGES string
	}
}

var Files = func() FilesTable {
	var table FilesTable
	table.Name = "files"
	table.Columns.ID = "id"
	table.Columns.FILE_KEY = "file_key"
	table.Columns.HASH = "hash"
	table.Columns.NAME = "name"
	table.Columns.MIME = "mime"
	table.Columns.SIZE = "size"
	table.Columns.CREATED_AT = "created_at"
	table.Columns.CREATOR_ID = "creator_id"
	table.Columns.PRIVILEGES = "privileges"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (FilesTable) As(alias string) FilesTable {
	table := Files
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.FILE_KEY = alias + "." + table.Columns.FILE_KEY
	table.Columns.HASH = alias + "." + table.Columns.HASH
	table.Columns.NAME = alias + "." + table.Columns.NAME
	table.Columns.MIME = alias + "." + table.Columns.MIME
	table.Columns.SIZE = alias + "." + table.Columns.SIZE
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	table.Columns.CREATOR_ID = alias + "." + table.Columns.CREATOR_ID
	table.Columns.PRIVILEGES = alias + "." + table.Columns.PRIVILEGES
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (FilesTable) Qualified() FilesTable {
	table := Files.As(Files.Name)
	table.Name = Files.Name
	return table
}
