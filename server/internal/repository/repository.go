// Package repository owns all GORM queries and persistence operations.
// repository 包负责全部 GORM 查询和持久化操作。
package repository

import (
	"context"
	"database/sql"
	"voex-server/internal/dbschema"
	"voex-server/internal/model"
	"voex-server/internal/shared"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func Must(result *gorm.DB) *gorm.DB { shared.Must(result.Error); return result }
func Rows(builder *gorm.DB) []shared.Row {
	result := make([]map[string]any, 0)
	Must(builder.Find(&result))
	rows := make([]shared.Row, 0, len(result))
	for _, row := range result {
		r := shared.Row{}
		for key, v := range row {
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			r[key] = v
		}
		rows = append(rows, r)
	}
	return rows
}
func One(builder *gorm.DB) shared.Row {
	rows := Rows(builder.Limit(1))
	if len(rows) == 0 {
		return nil
	}
	return rows[0]
}

// Transaction keeps permission checks and writes in the same locked snapshot.
// Transaction 让权限检查和写入处于同一个加锁快照内。
func Transaction(ctx context.Context, db *gorm.DB, write bool, fn func(*gorm.DB) any) any {
	var result any
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if write {
			wt := dbschema.WorkspaceState
			row := One(
				tx.Table(wt.Name).
					Select(wt.Columns.ID).
					Where(&model.WorkspaceState{ID: 1}, wt.Columns.ID).
					Clauses(clause.Locking{Strength: "UPDATE"}),
			)
			if row == nil {
				panic("workspace lock missing")
			}
		}
		result = fn(tx)
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	shared.Must(err)
	return result
}
