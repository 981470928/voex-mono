//go:build !windows

package filestore

import "os"

func syncDirectory(directory *os.File) error { return directory.Sync() }
