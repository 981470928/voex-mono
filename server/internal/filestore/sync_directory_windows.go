package filestore

import "os"

// Windows has no supported directory-fsync equivalent for these directory handles.
// The uploaded file is still flushed before the same-volume, no-replace hard link
// is published. Directory-entry power-loss durability is platform dependent.
// 对于这些目录句柄，Windows 没有受支持的目录 fsync 等效操作。
// 上传文件仍会先刷盘，再通过同卷且不覆盖已有目标的硬链接发布。
// 目录项在断电后的持久性取决于平台。
func syncDirectory(_ *os.File) error { return nil }
