package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

// CheckSearchIndex 校验全文搜索索引存在；缺失时拒绝启动，提示先执行显式迁移。
func (s *Service) CheckSearchIndex() error {
	if !s.db.Migrator().HasIndex("documents", "ft_documents_search") {
		return fmt.Errorf(
			"document search index missing; apply internal/database/document-search.sql",
		)
	}
	return nil
}

// searchText 清洗搜索输入：去除布尔模式操作符与引号，压缩空白。
func searchText(query string) string {
	var cleaned strings.Builder
	for _, r := range strings.TrimSpace(query) {
		if strings.ContainsRune("+-<>()~*\"@\\", r) {
			continue
		}
		cleaned.WriteRune(r)
	}
	return strings.Join(strings.Fields(cleaned.String()), " ")
}

// searchPhrase 把清洗后的文本包装为布尔模式短语；无可检索内容时返回空串。
func searchPhrase(query string) string {
	text := searchText(query)
	if text == "" {
		return ""
	}
	return `"` + text + `"`
}

// searchTerms 返回摘录定位用的候选词：完整短语优先，其次逐个空白分词。
func searchTerms(text string) []string {
	terms := make([]string, 0, 1+strings.Count(text, " "))
	if text != "" {
		terms = append(terms, text)
	}
	for _, term := range strings.Fields(text) {
		if term != text {
			terms = append(terms, term)
		}
	}
	return terms
}

// searchSnippet 返回命中位置附近的正文摘录；只在 flat 文本上取约 120 字符窗口，绝不返回全文。
func searchSnippet(content, query string) string {
	flat := strings.Join(strings.Fields(content), " ")
	if flat == "" {
		return ""
	}
	lower := strings.ToLower(flat)
	pos := -1
	for _, term := range searchTerms(searchText(query)) {
		needle := strings.ToLower(term)
		if needle == "" {
			continue
		}
		if index := strings.Index(lower, needle); index >= 0 {
			pos = index
			break
		}
	}
	runes := []rune(flat)
	start := 0
	if pos >= 0 {
		// 词形折叠可能轻微改变字节位置，先对齐到 UTF-8 字符边界。
		for pos > 0 && !utf8.RuneStart(flat[pos]) {
			pos--
		}
		start = utf8.RuneCountInString(flat[:pos]) - 40
		if start < 0 {
			start = 0
		}
	}
	end := start + 120
	if end > len(runes) {
		end = len(runes)
		if start = end - 120; start < 0 {
			start = 0
		}
	}
	snippet := string(runes[start:end])
	if start > 0 {
		snippet = "…" + snippet
	}
	if end < len(runes) {
		snippet += "…"
	}
	return snippet
}

func searchScore(v any) float64 {
	score, err := strconv.ParseFloat(shared.String(v), 64)
	if err != nil {
		return 0
	}
	return score
}

// searchDocumentDTO 是搜索结果条目：目录元数据加命中摘录，不携带正文。
func searchDocumentDTO(row shared.Row, snippet string) shared.Row {
	return shared.Row{
		"id":           row["id"],
		"file_key":     row["file_key"],
		"file_name":    row["file_name"],
		"project_key":  row["project_key"],
		"project_name": row["project_name"],
		"folder_key":   row["folder_key"],
		"folder_name":  row["folder_name"],
		"team_key":     row["team_key"],
		"creator": shared.Row{
			"id":     row["creator_id"],
			"name":   row["creator_name"],
			"avator": row["creator_avator"],
		},
		"created_at": shared.Timestamp(
			row["created_at"],
		),
		"updated_at": shared.Timestamp(row["updated_at"]),
		"revision":   shared.Int64(row["revision"]),
		"snippet":    snippet,
		"score":      searchScore(row["score"]),
	}
}

// SearchDocuments 在指定团队内全文搜索文档名称与正文，覆盖调用者有读或写权限的文件，返回命中摘录而非正文。
func (s *Service) SearchDocuments(
	ctx context.Context,
	teamKey, query string,
	limit, offset int64,
) shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		team := s.SelectedTeam(db, ctx, teamKey)
		userID := shared.String(identity.User(ctx)["id"])
		phrase := searchPhrase(query)
		if phrase == "" {
			return shared.Row{"items": []shared.Row{}, "total": int64(0)}
		}
		total := repository.CountSearchDocuments(db, userID, team["id"], phrase)
		rows := repository.SearchDocuments(db, userID, team["id"], phrase, limit, offset)
		items := make([]shared.Row, 0, len(rows))
		for _, row := range rows {
			snippet := searchSnippet(shared.String(row["file_content"]), query)
			items = append(items, searchDocumentDTO(row, snippet))
		}
		return shared.Row{"items": items, "total": total}
	}).(shared.Row)
}
