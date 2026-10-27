// Package database opens MySQL connections without changing the schema.
package database

import (
	"time"
	"voex-server/internal/config"

	driver "github.com/go-sql-driver/mysql"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Open connects to an existing database. Initialize an empty database with schema.sql first.
func Open(settings config.Database) (*gorm.DB, error) {
	cfg := driver.NewConfig()
	cfg.Net = "tcp"
	cfg.Addr = settings.Host + ":" + settings.Port
	cfg.User, cfg.Passwd, cfg.DBName = settings.User, settings.Password, settings.Name
	cfg.ParseTime, cfg.Loc = true, time.Local
	cfg.Timeout, cfg.ReadTimeout, cfg.WriteTimeout = 10*time.Second, 30*time.Second, 30*time.Second
	cfg.Collation = "utf8mb4_unicode_ci"
	db, err := gorm.Open(mysql.Open(cfg.FormatDSN()), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent), SkipDefaultTransaction: true,
	})
	if err != nil {
		return nil, err
	}
	pool, err := db.DB()
	if err != nil {
		return nil, err
	}
	pool.SetMaxOpenConns(10)
	pool.SetMaxIdleConns(10)
	pool.SetConnMaxLifetime(5 * time.Minute)
	return db, nil
}
