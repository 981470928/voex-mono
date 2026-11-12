package repository

import (
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

const relationBatchSize = 500

// rowValues deduplicates relation keys without turning SQL NULL into an empty key.
// rowValues 对关联 key 去重，不会将 SQL NULL 转成空 key。
func rowValues(rows []shared.Row, columns ...string) []any {
	values := make([]any, 0, len(rows))
	seen := make(map[string]bool)
	for _, row := range rows {
		for _, column := range columns {
			value := row[column]
			key := shared.String(value)
			if value != nil && key != "" && !seen[key] {
				seen[key] = true
				values = append(values, value)
			}
		}
	}
	return values
}

// queryRowsIn loads relations in bounded batches on the caller's connection/transaction.
// Query/table/column names are repository constants, never request input. Callers
// retain the original base-row order; a global ORDER/LIMIT must not span batches.
// queryRowsIn 使用调用方的连接或事务，按受限批次加载关联数据。
// 查询、表名和列名均为 repository 常量，绝不来自请求输入。
// 调用方保留原始主记录顺序；全局 ORDER/LIMIT 不得跨批次应用。
func queryRowsIn(query *gorm.DB, column string, values []any) []shared.Row {
	rows := make([]shared.Row, 0)
	for start := 0; start < len(values); start += relationBatchSize {
		end := min(start+relationBatchSize, len(values))
		batch := query.Session(&gorm.Session{}).Where(column+" IN ?", values[start:end])
		rows = append(rows, Rows(batch)...)
	}
	return rows
}

func rowsByKey(query *gorm.DB, column string, values []any) map[string]shared.Row {
	indexed := make(map[string]shared.Row)
	for _, row := range queryRowsIn(query, column, values) {
		indexed[shared.String(row[column])] = row
	}
	return indexed
}

func firstRow(rows []shared.Row) shared.Row {
	if len(rows) == 0 {
		return nil
	}
	return rows[0]
}
