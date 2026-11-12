package dbschema

// DocumentsTable 定义表名与物理字段。
type DocumentsTable struct {
	Name    string
	Columns struct {
		ID                   string
		FILE_KEY             string
		FILE_NAME            string
		FILE_CONTENT         string
		CONTENT_MODE         string
		CREATED_AT           string
		UPDATED_AT           string
		FOLDER_ID            string
		CREATOR_ID           string
		PRIVILEGES           string
		REVISION             string
		UPDATED_BY           string
		UPDATED_BY_ANONYMOUS string
		DELETED_AT           string
		DELETED_BY           string
		EXPIRES_AT           string
	}
}

var Documents = func() DocumentsTable {
	var table DocumentsTable
	table.Name = "documents"
	table.Columns.ID = "id"
	table.Columns.FILE_KEY = "file_key"
	table.Columns.FILE_NAME = "file_name"
	table.Columns.FILE_CONTENT = "file_content"
	table.Columns.CONTENT_MODE = "content_mode"
	table.Columns.CREATED_AT = "created_at"
	table.Columns.UPDATED_AT = "updated_at"
	table.Columns.FOLDER_ID = "folder_id"
	table.Columns.CREATOR_ID = "creator_id"
	table.Columns.PRIVILEGES = "privileges"
	table.Columns.REVISION = "revision"
	table.Columns.UPDATED_BY = "updated_by"
	table.Columns.UPDATED_BY_ANONYMOUS = "updated_by_anonymous"
	table.Columns.DELETED_AT = "deleted_at"
	table.Columns.DELETED_BY = "deleted_by"
	table.Columns.EXPIRES_AT = "expires_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (DocumentsTable) As(alias string) DocumentsTable {
	table := Documents
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.FILE_KEY = alias + "." + table.Columns.FILE_KEY
	table.Columns.FILE_NAME = alias + "." + table.Columns.FILE_NAME
	table.Columns.FILE_CONTENT = alias + "." + table.Columns.FILE_CONTENT
	table.Columns.CONTENT_MODE = alias + "." + table.Columns.CONTENT_MODE
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	table.Columns.UPDATED_AT = alias + "." + table.Columns.UPDATED_AT
	table.Columns.FOLDER_ID = alias + "." + table.Columns.FOLDER_ID
	table.Columns.CREATOR_ID = alias + "." + table.Columns.CREATOR_ID
	table.Columns.PRIVILEGES = alias + "." + table.Columns.PRIVILEGES
	table.Columns.REVISION = alias + "." + table.Columns.REVISION
	table.Columns.UPDATED_BY = alias + "." + table.Columns.UPDATED_BY
	table.Columns.UPDATED_BY_ANONYMOUS = alias + "." + table.Columns.UPDATED_BY_ANONYMOUS
	table.Columns.DELETED_AT = alias + "." + table.Columns.DELETED_AT
	table.Columns.DELETED_BY = alias + "." + table.Columns.DELETED_BY
	table.Columns.EXPIRES_AT = alias + "." + table.Columns.EXPIRES_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (DocumentsTable) Qualified() DocumentsTable {
	table := Documents.As(Documents.Name)
	table.Name = Documents.Name
	return table
}

// DocumentSharingTable 定义表名与物理字段。
type DocumentSharingTable struct {
	Name    string
	Columns struct {
		DOCUMENT_ID  string
		READ_ENABLED string
		EDIT_ENABLED string
	}
}

var DocumentSharing = func() DocumentSharingTable {
	var table DocumentSharingTable
	table.Name = "document_sharing"
	table.Columns.DOCUMENT_ID = "document_id"
	table.Columns.READ_ENABLED = "read_enabled"
	table.Columns.EDIT_ENABLED = "edit_enabled"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (DocumentSharingTable) As(alias string) DocumentSharingTable {
	table := DocumentSharing
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.DOCUMENT_ID = alias + "." + table.Columns.DOCUMENT_ID
	table.Columns.READ_ENABLED = alias + "." + table.Columns.READ_ENABLED
	table.Columns.EDIT_ENABLED = alias + "." + table.Columns.EDIT_ENABLED
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (DocumentSharingTable) Qualified() DocumentSharingTable {
	table := DocumentSharing.As(DocumentSharing.Name)
	table.Name = DocumentSharing.Name
	return table
}

// DocumentAccessTable 定义表名与物理字段。
type DocumentAccessTable struct {
	Name    string
	Columns struct {
		DOCUMENT_ID string
		USER_ID     string
		PERMISSION  string
		GRANTED_AT  string
	}
}

var DocumentAccess = func() DocumentAccessTable {
	var table DocumentAccessTable
	table.Name = "document_access"
	table.Columns.DOCUMENT_ID = "document_id"
	table.Columns.USER_ID = "user_id"
	table.Columns.PERMISSION = "permission"
	table.Columns.GRANTED_AT = "granted_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (DocumentAccessTable) As(alias string) DocumentAccessTable {
	table := DocumentAccess
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.DOCUMENT_ID = alias + "." + table.Columns.DOCUMENT_ID
	table.Columns.USER_ID = alias + "." + table.Columns.USER_ID
	table.Columns.PERMISSION = alias + "." + table.Columns.PERMISSION
	table.Columns.GRANTED_AT = alias + "." + table.Columns.GRANTED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (DocumentAccessTable) Qualified() DocumentAccessTable {
	table := DocumentAccess.As(DocumentAccess.Name)
	table.Name = DocumentAccess.Name
	return table
}

// DocumentVersionsTable 定义表名与物理字段。
type DocumentVersionsTable struct {
	Name    string
	Columns struct {
		ID                   string
		DOCUMENT_ID          string
		REVISION             string
		KIND                 string
		LABEL                string
		CONTENT              string
		CONTENT_HASH         string
		SCHEMA_VERSION       string
		CREATED_BY           string
		CREATED_BY_ANONYMOUS string
		CREATED_AT           string
	}
}

var DocumentVersions = func() DocumentVersionsTable {
	var table DocumentVersionsTable
	table.Name = "document_versions"
	table.Columns.ID = "id"
	table.Columns.DOCUMENT_ID = "document_id"
	table.Columns.REVISION = "revision"
	table.Columns.KIND = "kind"
	table.Columns.LABEL = "label"
	table.Columns.CONTENT = "content"
	table.Columns.CONTENT_HASH = "content_hash"
	table.Columns.SCHEMA_VERSION = "schema_version"
	table.Columns.CREATED_BY = "created_by"
	table.Columns.CREATED_BY_ANONYMOUS = "created_by_anonymous"
	table.Columns.CREATED_AT = "created_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (DocumentVersionsTable) As(alias string) DocumentVersionsTable {
	table := DocumentVersions
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.DOCUMENT_ID = alias + "." + table.Columns.DOCUMENT_ID
	table.Columns.REVISION = alias + "." + table.Columns.REVISION
	table.Columns.KIND = alias + "." + table.Columns.KIND
	table.Columns.LABEL = alias + "." + table.Columns.LABEL
	table.Columns.CONTENT = alias + "." + table.Columns.CONTENT
	table.Columns.CONTENT_HASH = alias + "." + table.Columns.CONTENT_HASH
	table.Columns.SCHEMA_VERSION = alias + "." + table.Columns.SCHEMA_VERSION
	table.Columns.CREATED_BY = alias + "." + table.Columns.CREATED_BY
	table.Columns.CREATED_BY_ANONYMOUS = alias + "." + table.Columns.CREATED_BY_ANONYMOUS
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (DocumentVersionsTable) Qualified() DocumentVersionsTable {
	table := DocumentVersions.As(DocumentVersions.Name)
	table.Name = DocumentVersions.Name
	return table
}

// RecentFilesTable 定义表名与物理字段。
type RecentFilesTable struct {
	Name    string
	Columns struct {
		USER_ID     string
		DOCUMENT_ID string
		SHARE_ID    string
		FILE_NAME   string
		VIEWED_AT   string
	}
}

var RecentFiles = func() RecentFilesTable {
	var table RecentFilesTable
	table.Name = "recent_files"
	table.Columns.USER_ID = "user_id"
	table.Columns.DOCUMENT_ID = "document_id"
	table.Columns.SHARE_ID = "share_id"
	table.Columns.FILE_NAME = "file_name"
	table.Columns.VIEWED_AT = "viewed_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (RecentFilesTable) As(alias string) RecentFilesTable {
	table := RecentFiles
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.USER_ID = alias + "." + table.Columns.USER_ID
	table.Columns.DOCUMENT_ID = alias + "." + table.Columns.DOCUMENT_ID
	table.Columns.SHARE_ID = alias + "." + table.Columns.SHARE_ID
	table.Columns.FILE_NAME = alias + "." + table.Columns.FILE_NAME
	table.Columns.VIEWED_AT = alias + "." + table.Columns.VIEWED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (RecentFilesTable) Qualified() RecentFilesTable {
	table := RecentFiles.As(RecentFiles.Name)
	table.Name = RecentFiles.Name
	return table
}

// FileSharesTable 定义表名与物理字段。
type FileSharesTable struct {
	Name    string
	Columns struct {
		ID          string
		DOCUMENT_ID string
		TOKEN_HASH  string
		PERMISSION  string
		CREATED_BY  string
		CREATED_AT  string
		REVOKED_AT  string
	}
}

var FileShares = func() FileSharesTable {
	var table FileSharesTable
	table.Name = "file_shares"
	table.Columns.ID = "id"
	table.Columns.DOCUMENT_ID = "document_id"
	table.Columns.TOKEN_HASH = "token_hash"
	table.Columns.PERMISSION = "permission"
	table.Columns.CREATED_BY = "created_by"
	table.Columns.CREATED_AT = "created_at"
	table.Columns.REVOKED_AT = "revoked_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (FileSharesTable) As(alias string) FileSharesTable {
	table := FileShares
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.DOCUMENT_ID = alias + "." + table.Columns.DOCUMENT_ID
	table.Columns.TOKEN_HASH = alias + "." + table.Columns.TOKEN_HASH
	table.Columns.PERMISSION = alias + "." + table.Columns.PERMISSION
	table.Columns.CREATED_BY = alias + "." + table.Columns.CREATED_BY
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	table.Columns.REVOKED_AT = alias + "." + table.Columns.REVOKED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (FileSharesTable) Qualified() FileSharesTable {
	table := FileShares.As(FileShares.Name)
	table.Name = FileShares.Name
	return table
}
