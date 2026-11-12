package dbschema

// AIModelsTable 定义表名与物理字段。
type AIModelsTable struct {
	Name    string
	Columns struct {
		ID                 string
		USER_ID            string
		NAME               string
		PROTOCOL           string
		BASE_URL           string
		MODEL              string
		KEY_CIPHER         string
		TEMPERATURE        string
		MAX_TOKENS         string
		TOKEN_PARAMETER    string
		MULTIMODAL_ENABLED string
		CREATED_AT         string
		WEB_SEARCH_ENABLED string
	}
}

var AIModels = func() AIModelsTable {
	var table AIModelsTable
	table.Name = "ai_models"
	table.Columns.ID = "id"
	table.Columns.USER_ID = "user_id"
	table.Columns.NAME = "name"
	table.Columns.PROTOCOL = "protocol"
	table.Columns.BASE_URL = "base_url"
	table.Columns.MODEL = "model"
	table.Columns.KEY_CIPHER = "key_cipher"
	table.Columns.TEMPERATURE = "temperature"
	table.Columns.MAX_TOKENS = "max_tokens"
	table.Columns.TOKEN_PARAMETER = "token_parameter"
	table.Columns.MULTIMODAL_ENABLED = "multimodal_enabled"
	table.Columns.CREATED_AT = "created_at"
	table.Columns.WEB_SEARCH_ENABLED = "web_search_enabled"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (AIModelsTable) As(alias string) AIModelsTable {
	table := AIModels
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.USER_ID = alias + "." + table.Columns.USER_ID
	table.Columns.NAME = alias + "." + table.Columns.NAME
	table.Columns.PROTOCOL = alias + "." + table.Columns.PROTOCOL
	table.Columns.BASE_URL = alias + "." + table.Columns.BASE_URL
	table.Columns.MODEL = alias + "." + table.Columns.MODEL
	table.Columns.KEY_CIPHER = alias + "." + table.Columns.KEY_CIPHER
	table.Columns.TEMPERATURE = alias + "." + table.Columns.TEMPERATURE
	table.Columns.MAX_TOKENS = alias + "." + table.Columns.MAX_TOKENS
	table.Columns.TOKEN_PARAMETER = alias + "." + table.Columns.TOKEN_PARAMETER
	table.Columns.MULTIMODAL_ENABLED = alias + "." + table.Columns.MULTIMODAL_ENABLED
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	table.Columns.WEB_SEARCH_ENABLED = alias + "." + table.Columns.WEB_SEARCH_ENABLED
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (AIModelsTable) Qualified() AIModelsTable {
	table := AIModels.As(AIModels.Name)
	table.Name = AIModels.Name
	return table
}

// AIReviewApplicationsTable 定义表名与物理字段。
type AIReviewApplicationsTable struct {
	Name    string
	Columns struct {
		REVIEW_ID    string
		USER_ID      string
		PAYLOAD_HASH string
		RESULT_JSON  string
		CREATED_AT   string
	}
}

var AIReviewApplications = func() AIReviewApplicationsTable {
	var table AIReviewApplicationsTable
	table.Name = "ai_review_applications"
	table.Columns.REVIEW_ID = "review_id"
	table.Columns.USER_ID = "user_id"
	table.Columns.PAYLOAD_HASH = "payload_hash"
	table.Columns.RESULT_JSON = "result_json"
	table.Columns.CREATED_AT = "created_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (AIReviewApplicationsTable) As(alias string) AIReviewApplicationsTable {
	table := AIReviewApplications
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.REVIEW_ID = alias + "." + table.Columns.REVIEW_ID
	table.Columns.USER_ID = alias + "." + table.Columns.USER_ID
	table.Columns.PAYLOAD_HASH = alias + "." + table.Columns.PAYLOAD_HASH
	table.Columns.RESULT_JSON = alias + "." + table.Columns.RESULT_JSON
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (AIReviewApplicationsTable) Qualified() AIReviewApplicationsTable {
	table := AIReviewApplications.As(AIReviewApplications.Name)
	table.Name = AIReviewApplications.Name
	return table
}

// AIConversationSessionsTable 定义表名与物理字段。
type AIConversationSessionsTable struct {
	Name    string
	Columns struct {
		ID          string
		USER_ID     string
		DOCUMENT_ID string
		SESSION_ID  string
		TITLE       string
		CREATED_AT  string
		UPDATED_AT  string
	}
}

var AIConversationSessions = func() AIConversationSessionsTable {
	var table AIConversationSessionsTable
	table.Name = "ai_conversation_sessions"
	table.Columns.ID = "id"
	table.Columns.USER_ID = "user_id"
	table.Columns.DOCUMENT_ID = "document_id"
	table.Columns.SESSION_ID = "session_id"
	table.Columns.TITLE = "title"
	table.Columns.CREATED_AT = "created_at"
	table.Columns.UPDATED_AT = "updated_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (AIConversationSessionsTable) As(alias string) AIConversationSessionsTable {
	table := AIConversationSessions
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.USER_ID = alias + "." + table.Columns.USER_ID
	table.Columns.DOCUMENT_ID = alias + "." + table.Columns.DOCUMENT_ID
	table.Columns.SESSION_ID = alias + "." + table.Columns.SESSION_ID
	table.Columns.TITLE = alias + "." + table.Columns.TITLE
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	table.Columns.UPDATED_AT = alias + "." + table.Columns.UPDATED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (AIConversationSessionsTable) Qualified() AIConversationSessionsTable {
	table := AIConversationSessions.As(AIConversationSessions.Name)
	table.Name = AIConversationSessions.Name
	return table
}

// AIConversationTurnsTable 定义表名与物理字段。
type AIConversationTurnsTable struct {
	Name    string
	Columns struct {
		ID           string
		USER_ID      string
		DOCUMENT_ID  string
		SESSION_ID   string
		TURN_ID      string
		MODEL_ID     string
		PROMPT       string
		ATTACHMENTS  string
		RESPONSE     string
		ACTIVITY     string
		ERROR        string
		REVIEW_ID    string
		REVIEW_JSON  string
		FINISH_HASH  string
		CREATED_AT   string
		COMPLETED_AT string
	}
}

var AIConversationTurns = func() AIConversationTurnsTable {
	var table AIConversationTurnsTable
	table.Name = "ai_conversation_turns"
	table.Columns.ID = "id"
	table.Columns.USER_ID = "user_id"
	table.Columns.DOCUMENT_ID = "document_id"
	table.Columns.SESSION_ID = "session_id"
	table.Columns.TURN_ID = "turn_id"
	table.Columns.MODEL_ID = "model_id"
	table.Columns.PROMPT = "prompt"
	table.Columns.ATTACHMENTS = "attachments"
	table.Columns.RESPONSE = "response"
	table.Columns.ACTIVITY = "activity"
	table.Columns.ERROR = "error"
	table.Columns.REVIEW_ID = "review_id"
	table.Columns.REVIEW_JSON = "review_json"
	table.Columns.FINISH_HASH = "finish_hash"
	table.Columns.CREATED_AT = "created_at"
	table.Columns.COMPLETED_AT = "completed_at"
	return table
}()

// As 仅用于同表多次关联等必须使用 SQL 别名的场景。
func (AIConversationTurnsTable) As(alias string) AIConversationTurnsTable {
	table := AIConversationTurns
	if alias == "" {
		return table
	}
	table.Name += " AS " + alias
	table.Columns.ID = alias + "." + table.Columns.ID
	table.Columns.USER_ID = alias + "." + table.Columns.USER_ID
	table.Columns.DOCUMENT_ID = alias + "." + table.Columns.DOCUMENT_ID
	table.Columns.SESSION_ID = alias + "." + table.Columns.SESSION_ID
	table.Columns.TURN_ID = alias + "." + table.Columns.TURN_ID
	table.Columns.MODEL_ID = alias + "." + table.Columns.MODEL_ID
	table.Columns.PROMPT = alias + "." + table.Columns.PROMPT
	table.Columns.ATTACHMENTS = alias + "." + table.Columns.ATTACHMENTS
	table.Columns.RESPONSE = alias + "." + table.Columns.RESPONSE
	table.Columns.ACTIVITY = alias + "." + table.Columns.ACTIVITY
	table.Columns.ERROR = alias + "." + table.Columns.ERROR
	table.Columns.REVIEW_ID = alias + "." + table.Columns.REVIEW_ID
	table.Columns.REVIEW_JSON = alias + "." + table.Columns.REVIEW_JSON
	table.Columns.FINISH_HASH = alias + "." + table.Columns.FINISH_HASH
	table.Columns.CREATED_AT = alias + "." + table.Columns.CREATED_AT
	table.Columns.COMPLETED_AT = alias + "." + table.Columns.COMPLETED_AT
	return table
}

// Qualified 保留原表名，仅为消除歧义提供带表名前缀的字段。
func (AIConversationTurnsTable) Qualified() AIConversationTurnsTable {
	table := AIConversationTurns.As(AIConversationTurns.Name)
	table.Name = AIConversationTurns.Name
	return table
}
