package database

import (
	"context"
	_ "embed"
	"fmt"
	"regexp"
	"strings"
	"time"
	"voex-server/internal/config"
	"voex-server/internal/dbschema"
)

//go:embed schema.sql
var schemaSource string

var schemaTablePattern = regexp.MustCompile(
	"(?im)^CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?`?([a-z_]+)`?\\s*\\(",
)

// Check connects to the configured database and reads schema metadata only.
// It does not create tables, migrate data or start application workers.
// Check 连接配置的数据库，仅读取 schema 元数据。
// 它不会创建表、迁移数据或启动应用后台任务。
func Check(settings config.Database, collaboration bool) error {
	db, err := Open(settings)
	if err != nil {
		return fmt.Errorf(
			"database connection failed; check MYSQL_HOST, MYSQL_PORT, MYSQL_USER, " +
				"MYSQL_PASSWORD and MYSQL_DATABASE",
		)
	}
	pool, err := db.DB()
	if err != nil {
		return fmt.Errorf("database connection pool unavailable")
	}
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	rows, err := pool.QueryContext(
		ctx,
		"SELECT "+dbschema.CatalogTables.Columns.TABLE_NAME+
			" FROM "+dbschema.CatalogTables.Name+
			" WHERE "+dbschema.CatalogTables.Columns.TABLE_SCHEMA+" = DATABASE() AND "+
			dbschema.CatalogTables.Columns.TABLE_TYPE+" = 'BASE TABLE'",
	)
	if err != nil {
		return fmt.Errorf("database schema metadata could not be read; check database permissions")
	}
	defer rows.Close()
	present := map[string]bool{}
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			return fmt.Errorf("database schema metadata could not be read")
		}
		present[table] = true
	}
	if rows.Err() != nil {
		return fmt.Errorf("database schema metadata could not be read")
	}
	matches := schemaTablePattern.FindAllStringSubmatch(schemaSource, -1)
	if len(matches) == 0 {
		return fmt.Errorf("embedded database schema could not be read")
	}
	missing := []string{}
	for _, match := range matches {
		table := match[1]
		if !collaboration &&
			(table == dbschema.DocumentCollaboration.Name ||
				table == dbschema.CollaborationCommits.Name ||
				table == dbschema.CollaborationOutbox.Name) {
			continue
		}
		if !present[table] {
			missing = append(missing, table)
		}
	}
	if len(missing) != 0 {
		return fmt.Errorf(
			"database tables missing: %s; run voex-server init-db "+
				"or start without --check to create missing tables",
			strings.Join(missing, ", "),
		)
	}
	if collaboration {
		var count int
		err = pool.QueryRowContext(
			ctx,
			"SELECT COUNT(*) FROM "+dbschema.CatalogColumns.Name+
				" WHERE "+dbschema.CatalogColumns.Columns.TABLE_SCHEMA+" = DATABASE() AND "+
				dbschema.CatalogColumns.Columns.TABLE_NAME+" = ? AND "+
				dbschema.CatalogColumns.Columns.COLUMN_NAME+" = ?",
			dbschema.Documents.Name,
			dbschema.Documents.Columns.CONTENT_MODE,
		).
			Scan(&count)
		if err != nil || count != 1 {
			return fmt.Errorf(
				"collaboration column documents.content_mode is missing; " +
					"apply server/internal/database/collaboration.sql explicitly",
			)
		}
	}
	return nil
}
