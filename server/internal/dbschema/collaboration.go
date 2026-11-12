package dbschema

// DocumentCollaborationTable 定义表名与物理字段。
type DocumentCollaborationTable struct {
	Name    string
	Columns struct {
		DOCUMENT_ID    string
		STATE          string
		SCHEMA_VERSION string
		EPOCH          string
		COLLAB_SEQ     string
		UPDATED_AT     string
	}
}

var DocumentCollaboration = func() DocumentCollaborationTable {
	var table DocumentCollaborationTable
	table.Name = "document_collaboration"
	table.Columns.DOCUMENT_ID = "document_id"
	table.Columns.STATE = "state"
	table.Columns.SCHEMA_VERSION = "schema_version"
	table.Columns.EPOCH = "epoch"
	table.Columns.COLLAB_SEQ = "collab_seq"
	table.Columns.UPDATED_AT = "updated_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (DocumentCollaborationTable) As(alias string) DocumentCollaborationTable {
	table := DocumentCollaboration
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.DOCUMENT_ID = alias + "." + table.Columns.DOCUMENT_ID
	table.Columns.STATE = alias + "." + table.Columns.STATE
	table.Columns.SCHEMA_VERSION = alias + "." + table.Columns.SCHEMA_VERSION
	table.Columns.EPOCH = alias + "." + table.Columns.EPOCH
	table.Columns.COLLAB_SEQ = alias + "." + table.Columns.COLLAB_SEQ
	table.Columns.UPDATED_AT = alias + "." + table.Columns.UPDATED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (DocumentCollaborationTable) Qualified() DocumentCollaborationTable {
	table := DocumentCollaboration.As(DocumentCollaboration.Name)
	table.Name = DocumentCollaboration.Name
	return table
}

// CollaborationCommitsTable 定义表名与物理字段。
type CollaborationCommitsTable struct {
	Name    string
	Columns struct {
		DOCUMENT_ID  string
		COMMIT_KEY   string
		PAYLOAD_HASH string
		COLLAB_SEQ   string
		REVISION     string
		CREATED_AT   string
	}
}

var CollaborationCommits = func() CollaborationCommitsTable {
	var table CollaborationCommitsTable
	table.Name = "collaboration_commits"
	table.Columns.DOCUMENT_ID = "document_id"
	table.Columns.COMMIT_KEY = "commit_key"
	table.Columns.PAYLOAD_HASH = "payload_hash"
	table.Columns.COLLAB_SEQ = "collab_seq"
	table.Columns.REVISION = "revision"
	table.Columns.CREATED_AT = "created_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (CollaborationCommitsTable) As(alias string) CollaborationCommitsTable {
	table := CollaborationCommits
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.DOCUMENT_ID = alias + "." + table.Columns.DOCUMENT_ID
	table.Columns.COMMIT_KEY = alias + "." + table.Columns.COMMIT_KEY
	table.Columns.PAYLOAD_HASH = alias + "." + table.Columns.PAYLOAD_HASH
	table.Columns.COLLAB_SEQ = alias + "." + table.Columns.COLLAB_SEQ
	table.Columns.REVISION = alias + "." + table.Columns.REVISION
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (CollaborationCommitsTable) Qualified() CollaborationCommitsTable {
	table := CollaborationCommits.As(CollaborationCommits.Name)
	table.Name = CollaborationCommits.Name
	return table
}

// CollaborationOutboxTable 定义表名与物理字段。
type CollaborationOutboxTable struct {
	Name    string
	Columns struct {
		ID         string
		KIND       string
		FILE_KEY   string
		CREATED_AT string
	}
}

var CollaborationOutbox = func() CollaborationOutboxTable {
	var table CollaborationOutboxTable
	table.Name = "collaboration_outbox"
	table.Columns.ID = "id"
	table.Columns.KIND = "kind"
	table.Columns.FILE_KEY = "file_key"
	table.Columns.CREATED_AT = "created_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (CollaborationOutboxTable) As(alias string) CollaborationOutboxTable {
	table := CollaborationOutbox
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.KIND = alias + "." + table.Columns.KIND
	table.Columns.FILE_KEY = alias + "." + table.Columns.FILE_KEY
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (CollaborationOutboxTable) Qualified() CollaborationOutboxTable {
	table := CollaborationOutbox.As(CollaborationOutbox.Name)
	table.Name = CollaborationOutbox.Name
	return table
}
