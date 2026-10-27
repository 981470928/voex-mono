// Package database manages MySQL connections and initial schema creation.
package database

import (
	"net"
	"time"
	"voex-server/internal/config"

	driver "github.com/go-sql-driver/mysql"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func connectionConfig(settings config.Database) *driver.Config {
	cfg := driver.NewConfig()
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(settings.Host, settings.Port)
	cfg.User, cfg.Passwd, cfg.DBName = settings.User, settings.Password, settings.Name
	cfg.ParseTime, cfg.Loc = true, time.Local
	cfg.Timeout, cfg.ReadTimeout, cfg.WriteTimeout = 10*time.Second, 30*time.Second, 30*time.Second
	cfg.Collation = "utf8mb4_unicode_ci"
	return cfg
}

// Open connects to an existing database; Initialize creates missing databases and tables.
func Open(settings config.Database) (*gorm.DB, error) {
	cfg := connectionConfig(settings)
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
