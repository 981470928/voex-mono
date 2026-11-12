// Package dbschema 按业务模块直接维护 Go 表定义与字段定义。
// 查询优先使用局部表变量和无前缀字段；Qualified 用于歧义列，As 用于必要的 SQL 别名。
package dbschema

import "strings"

// List 将字段或表达式组合为 SQL 列表。
func List(columns ...string) string { return strings.Join(columns, ",") }
