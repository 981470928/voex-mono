package app

import (
	"bytes"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"voex-server/internal/config"
	"voex-server/internal/database"
)

// CheckConfig checks local prerequisites and the database without starting the service.
func CheckConfig() (err error) {
	defer func() {
		if recover() != nil {
			err = fmt.Errorf("configuration could not be loaded; check VOEX_ENV_FILE and its quoting")
		}
	}()
	cfg := config.Read()
	for _, key := range []string{"MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_DATABASE"} {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			return fmt.Errorf("required configuration %s is empty", key)
		}
	}
	if err := validPort("MYSQL_PORT", cfg.Database.Port); err != nil {
		return err
	}
	if strings.ContainsAny(cfg.Database.Host, "/\\\r\n\x00") {
		return fmt.Errorf("MYSQL_HOST must be a hostname or IP address")
	}
	_, port, err := net.SplitHostPort(cfg.Address)
	if err != nil {
		return fmt.Errorf("VOEX_ADDR must be a host:port address")
	}
	if err := validPort("VOEX_ADDR port", port); err != nil {
		return err
	}
	if timeout, parseErr := time.ParseDuration(config.Env("VOEX_HTTP_READ_TIMEOUT", "2m")); parseErr != nil || timeout <= 0 {
		return fmt.Errorf("VOEX_HTTP_READ_TIMEOUT must be a positive duration")
	}
	if !filepath.IsAbs(cfg.Storage.Root) {
		return fmt.Errorf("VOEX_STORAGE_ROOT must be an absolute path")
	}
	directory, err := os.Open(cfg.Storage.Root)
	if err != nil {
		return fmt.Errorf("VOEX_STORAGE_ROOT must exist and be readable")
	}
	_, readErr := directory.Readdirnames(1)
	info, statErr := directory.Stat()
	directory.Close()
	if statErr != nil || !info.IsDir() {
		return fmt.Errorf("VOEX_STORAGE_ROOT must be a readable directory")
	}
	if readErr != nil && readErr != io.EOF {
		return fmt.Errorf("VOEX_STORAGE_ROOT must be readable")
	}
	probe, err := os.CreateTemp(cfg.Storage.Root, ".voex-config-check-*")
	if err != nil {
		return fmt.Errorf("VOEX_STORAGE_ROOT must be writable")
	}
	probeName := probe.Name()
	_, writeErr := probe.Write([]byte("voex"))
	closeErr := probe.Close()
	removeErr := os.Remove(probeName)
	if writeErr != nil || closeErr != nil || removeErr != nil {
		return fmt.Errorf("VOEX_STORAGE_ROOT write/cleanup check failed")
	}
	if err := checkSecret("JWT_SECRET_FILE", cfg.SecretFile, 64, false); err != nil {
		return err
	}
	if err := checkSecret("SHARE_SECRET_FILE", config.Env("SHARE_SECRET_FILE", "/home/server/.secrets/share-key"), 64, false); err != nil {
		return err
	}
	enabled := config.Env("VOEX_COLLAB_ENABLED", "false")
	if enabled != "true" && enabled != "false" {
		return fmt.Errorf("VOEX_COLLAB_ENABLED must be true or false")
	}
	if cfg.Collaboration.Enabled {
		if _, err := collaborationTarget(cfg.Collaboration.URL); err != nil {
			return err
		}
		if err := checkSecret("VOEX_COLLAB_SECRET_FILE", cfg.Collaboration.SecretFile, 32, true); err != nil {
			return err
		}
		if cfg.Collaboration.WSURL != "/api/collab/ws" {
			return fmt.Errorf("VOEX_COLLAB_WS_URL must be /api/collab/ws for local deployment")
		}
	}
	if webRoot := config.Env("VOEX_WEB_ROOT", ""); webRoot != "" {
		closeWeb, err := checkWebRoot(webRoot)
		if err != nil {
			return err
		}
		closeWeb()
	}
	return database.Check(cfg.Database, cfg.Collaboration.Enabled)
}

func validPort(name, value string) error {
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("%s must be an integer from 1 to 65535", name)
	}
	return nil
}

func checkSecret(name, path string, minimum int, trim bool) error {
	if !filepath.IsAbs(path) {
		return fmt.Errorf("%s must be an absolute path", name)
	}
	value, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("%s must point to a readable secret file", name)
	}
	if trim {
		value = bytes.TrimSpace(value)
	}
	if len(value) < minimum {
		return fmt.Errorf("%s must contain at least %d bytes", name, minimum)
	}
	return nil
}
