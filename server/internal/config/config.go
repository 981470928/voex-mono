package config

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"voex-server/internal/shared"
)

func Env(k, fallback string) string {
	if v, ok := os.LookupEnv(k); ok {
		return v
	}
	return fallback
}
func Load() {
	file, err := os.Open(Env("VOEX_ENV_FILE", ".env"))
	if os.IsNotExist(err) {
		return
	}
	shared.Must(err)
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if strings.HasPrefix(v, "\"") {
			x, e := strconv.Unquote(v)
			shared.Must(e)
			v = x
		}
		if _, ok := os.LookupEnv(k); !ok {
			shared.Must(os.Setenv(k, v))
		}
	}
	shared.Must(scanner.Err())
}

// Config groups application settings; secrets are loaded from the environment.
type Config struct {
	Address, SecretFile string
	Database            Database
	Collaboration       Collaboration
	Storage             Storage
}
type Database struct{ Host, Port, User, Password, Name string }
type Storage struct{ Root string }

func Read() Config {
	Load()
	return Config{
		Address:    Env("VOEX_ADDR", "127.0.0.1:8090"),
		SecretFile: Env("JWT_SECRET_FILE", "/home/server/.secrets/jwt-key"),
		Database: Database{
			Host: Env("MYSQL_HOST", "127.0.0.1"), Port: Env("MYSQL_PORT", "3306"),
			User: Env("MYSQL_USER", "root"), Password: Env("MYSQL_PASSWORD", ""), Name: Env("MYSQL_DATABASE", "file_server"),
		},
		Collaboration: ReadCollaboration(),
		Storage:       Storage{Root: Env("VOEX_STORAGE_ROOT", "/home/static")},
	}
}
