package filestore

import "os"

// Windows has no supported directory-fsync equivalent for these directory handles.
// The uploaded file is still flushed before the same-volume, no-replace hard link
// is published. Directory-entry power-loss durability is platform dependent.
func syncDirectory(_ *os.File) error { return nil }
