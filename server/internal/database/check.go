package database

import (
	"context"
	_ "embed"
	"fmt"
	"regexp"
	"strings"
	"time"
	"voex-server/internal/config"
)

//go:embed schema.sql
var schemaSource string

// Check connects to the configured database and reads schema metadata only.
// It does not create tables, migrate data or start application workers.
func Check(settings config.Database, collaboration bool) error {
	db, err := Open(settings)
	if err != nil {
		return fmt.Errorf("database connection failed; check MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD and MYSQL_DATABASE")
	}
	pool, err := db.DB()
	if err != nil {
		return fmt.Errorf("database connection pool unavailable")
	}
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	rows, err := pool.QueryContext(ctx, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'")
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
	tablePattern := regexp.MustCompile("(?im)^CREATE TABLE\\s+`?([a-z_]+)`?\\s*\\(")
	matches := tablePattern.FindAllStringSubmatch(schemaSource, -1)
	if len(matches) == 0 {
		return fmt.Errorf("embedded database schema could not be read")
	}
	missing := []string{}
	for _, match := range matches {
		table := match[1]
		if !collaboration && (table == "document_collaboration" || table == "collaboration_commits" || table == "collaboration_outbox") {
			continue
		}
		if !present[table] {
			missing = append(missing, table)
		}
	}
	if len(missing) != 0 {
		return fmt.Errorf("database tables missing: %s; initialize a NEW EMPTY database using server/internal/database/schema.sql, or apply the appropriate explicit migrations to an existing database", strings.Join(missing, ", "))
	}
	if collaboration {
		var count int
		err = pool.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'content_mode'").Scan(&count)
		if err != nil || count != 1 {
			return fmt.Errorf("collaboration column documents.content_mode is missing; apply server/internal/database/collaboration.sql explicitly")
		}
	}
	return nil
}
