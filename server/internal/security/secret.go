package security

import (
	"crypto/rand"
	"os"
	"path/filepath"
	"voex-server/internal/shared"
)

func LoadSecret(path string) []byte {
	shared.Must(os.MkdirAll(filepath.Dir(path), 0700))
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err == nil {
		b := make([]byte, 64)
		_, err = rand.Read(b)
		shared.Must(err)
		_, err = file.Write(b)
		file.Close()
		shared.Must(err)
	} else if !os.IsExist(err) {
		shared.Must(err)
	}
	secret, err := os.ReadFile(path)
	shared.Must(err)
	if len(secret) < 64 {
		panic("JWT signing key is too short")
	}
	return secret
}
