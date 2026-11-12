package database

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"
	"voex-server/internal/config"
	"voex-server/internal/dbschema"

	driver "github.com/go-sql-driver/mysql"
)

// MySQL has no exported unknown-database sentinel; isolate the bootstrap-only protocol code.
// MySQL 未导出表示数据库不存在的哨兵错误；将仅用于初始化的协议错误码隔离在此处。
const mysqlUnknownDatabase uint16 = 1049

// Initialize creates only missing databases, tables and the workspace lock row.
// DDL is serialized on one MySQL session; an interrupted initialization can be rerun.
// Initialize 仅创建缺失的数据库、表和工作区锁记录。
// DDL 在同一个 MySQL 会话中串行执行；初始化中断后可重新运行。
func Initialize(settings config.Database) error {
	if strings.TrimSpace(settings.Name) == "" || strings.ContainsRune(settings.Name, 0) {
		return fmt.Errorf("MYSQL_DATABASE must be a non-empty database name")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	pool, err := openInitializationPool(ctx, settings)
	if err != nil {
		var mysqlError *driver.MySQLError
		if !errors.As(err, &mysqlError) || mysqlError.Number != mysqlUnknownDatabase {
			return fmt.Errorf(
				"database connection failed; check MYSQL_* credentials and permissions: %w",
				err,
			)
		}
		serverSettings := settings
		serverSettings.Name = ""
		server, err := openInitializationPool(ctx, serverSettings)
		if err != nil {
			return fmt.Errorf("database server connection failed: %w", err)
		}
		identifier := "`" + strings.ReplaceAll(settings.Name, "`", "``") + "`"
		_, err = server.ExecContext(
			ctx,
			"CREATE DATABASE IF NOT EXISTS "+identifier+
				" CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci",
		)
		server.Close()
		if err != nil {
			return fmt.Errorf(
				"database %q is missing and could not be created; "+
					"grant CREATE permission or create it manually: %w",
				settings.Name,
				err,
			)
		}
		log.Printf("[Database] Ensured database %q", settings.Name)
		pool, err = openInitializationPool(ctx, settings)
		if err != nil {
			return fmt.Errorf("created database could not be opened: %w", err)
		}
	}
	defer pool.Close()
	conn, err := pool.Conn(ctx)
	if err != nil {
		return fmt.Errorf("database initialization connection unavailable: %w", err)
	}
	defer conn.Close()
	sum := sha256.Sum256([]byte(strings.ToLower(settings.Name)))
	lockName := fmt.Sprintf("voex-schema:%x", sum[:24])
	var acquired sql.NullInt64
	if err := conn.QueryRowContext(ctx, "SELECT GET_LOCK(?, 30)", lockName).
		Scan(&acquired); err != nil || !acquired.Valid ||
		acquired.Int64 != 1 {
		return fmt.Errorf(
			"database initialization lock could not be acquired; " +
				"retry when other startup processes finish",
		)
	}
	defer func() {
		releaseCtx, releaseCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer releaseCancel()
		conn.ExecContext(releaseCtx, "SELECT RELEASE_LOCK(?)", lockName)
	}()

	rows, err := conn.QueryContext(
		ctx,
		"SELECT "+dbschema.CatalogTables.Columns.TABLE_NAME+
			" FROM "+dbschema.CatalogTables.Name+
			" WHERE "+dbschema.CatalogTables.Columns.TABLE_SCHEMA+" = DATABASE() AND "+
			dbschema.CatalogTables.Columns.TABLE_TYPE+" = 'BASE TABLE'",
	)
	if err != nil {
		return fmt.Errorf("database schema metadata could not be read: %w", err)
	}
	present := map[string]bool{}
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			rows.Close()
			return fmt.Errorf("database table metadata could not be read: %w", err)
		}
		present[table] = true
	}
	scanErr := rows.Err()
	rows.Close()
	if scanErr != nil {
		return fmt.Errorf("database table metadata could not be read: %w", scanErr)
	}

	// The embedded schema contains CREATE TABLE statements and one fixed seed,
	// with whole-line comments and no semicolons inside SQL string literals.
	// 内嵌 schema 包含 CREATE TABLE 语句和一条固定的初始数据语句；
	// 注释均独占整行，SQL 字符串字面量中不含分号。
	var source strings.Builder
	for _, line := range strings.Split(schemaSource, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			source.WriteString(line)
			source.WriteByte('\n')
		}
	}
	workspaceSeed := "INSERT IGNORE INTO " + dbschema.WorkspaceState.Name +
		" (" + dbschema.WorkspaceState.Columns.ID + ") VALUES (1)"
	tables := 0
	for _, part := range strings.Split(source.String(), ";") {
		statement := strings.TrimSpace(part)
		if statement == "" || statement == workspaceSeed {
			continue
		}
		match := schemaTablePattern.FindStringSubmatch(statement)
		if len(match) != 2 {
			return fmt.Errorf(
				"embedded database schema contains an unsupported initialization statement",
			)
		}
		tables++
		if present[match[1]] {
			continue
		}
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf(
				"database table %q could not be created; "+
					"check CREATE/REFERENCES permissions and existing schema compatibility: %w",
				match[1],
				err,
			)
		}
		log.Printf("[Database] Created missing table %q", match[1])
	}
	if tables == 0 {
		return fmt.Errorf("embedded database schema contains no table definitions")
	}
	var seeded bool
	if err := conn.QueryRowContext(
		ctx,
		"SELECT EXISTS(SELECT 1 FROM "+dbschema.WorkspaceState.Name+
			" WHERE "+dbschema.WorkspaceState.Columns.ID+" = 1)",
	).
		Scan(&seeded); err != nil {
		return fmt.Errorf("workspace initialization row could not be checked: %w", err)
	}
	if !seeded {
		if _, err := conn.ExecContext(ctx, workspaceSeed); err != nil {
			return fmt.Errorf("workspace initialization row could not be created: %w", err)
		}
		log.Printf("[Database] Created workspace initialization row")
	}
	return nil
}

func openInitializationPool(ctx context.Context, settings config.Database) (*sql.DB, error) {
	pool, err := sql.Open("mysql", connectionConfig(settings).FormatDSN())
	if err != nil {
		return nil, err
	}
	pool.SetMaxOpenConns(1)
	pool.SetMaxIdleConns(1)
	if err := pool.PingContext(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}
