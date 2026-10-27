package repository

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"voex-server/internal/shared"
)

// A recent record remembers a verified share ID, never the reusable link token.
func RecordRecentFile(db *gorm.DB, userID string, doc shared.Row) {
	values := map[string]any{
		"user_id": userID, "document_id": doc["id"], "file_name": doc["file_name"],
		"viewed_at": gorm.Expr("CURRENT_TIMESTAMP(6)"),
	}
	updates := map[string]any{"file_name": doc["file_name"], "viewed_at": gorm.Expr("CURRENT_TIMESTAMP(6)")}
	Must(db.Table("recent_files").Clauses(clause.OnConflict{DoUpdates: clause.Assignments(updates)}).Create(values))
}

func recentFileQuery(db *gorm.DB, userID string, content bool) *gorm.DB {
	columns := DocumentColumns + ",r.file_name AS viewed_name,r.viewed_at"
	if content {
		columns += ",d.file_content"
	}
	return DocumentQuery(db, false).Select(columns).
		Joins("JOIN recent_files r ON r.document_id=d.id AND r.user_id=?", userID)
}

func RecentFiles(db *gorm.DB, userID string, limit int) []shared.Row {
	return Rows(recentFileQuery(db, userID, false).Order("r.viewed_at DESC,r.document_id DESC").Limit(limit))
}

// Recompute the boundary while holding the workspace write lock: a file viewed
// since the list response must not be removed using an outdated snapshot.
func PruneRecentFiles(db *gorm.DB, userID string, limit int) {
	boundary := One(db.Table("recent_files").Select("viewed_at,document_id").
		Where("user_id=?", userID).Order("viewed_at DESC,document_id DESC").Offset(limit - 1))
	if boundary == nil {
		return
	}
	Must(db.Table("recent_files").Where(
		"user_id=? AND (viewed_at < ? OR (viewed_at = ? AND document_id < ?))",
		userID, boundary["viewed_at"], boundary["viewed_at"], boundary["document_id"],
	).Delete(&map[string]any{}))
}

func RecentFileByKey(db *gorm.DB, userID, key string, content bool) shared.Row {
	return One(recentFileQuery(db, userID, content).Where("d.file_key=?", key))
}

func RemoveRecentFile(db *gorm.DB, userID, key string) {
	Must(db.Table("recent_files").Where("user_id=? AND document_id IN (?)", userID,
		db.Table("documents").Select("id").Where("file_key=?", key)).Delete(&map[string]any{}))
}
