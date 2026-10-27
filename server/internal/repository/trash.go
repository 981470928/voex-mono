package repository

import (
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

// TrashFolderByKey 查询文件夹及其删除状态，供回收站操作使用。
func TrashFolderByKey(db *gorm.DB, key string) shared.Row {
	return One(db.Table("folders AS f").
		Select("f.id, f.project_id, f.deleted_at, f.deleted_by, p.project_key").
		Joins("JOIN projects p ON p.id = f.project_id").
		Where("f.folder_key = ?", key))
}

// TrashRestoreFolder 恢复尚未到期的文件夹，返回是否成功。
func TrashRestoreFolder(db *gorm.DB, folderID any) bool {
	result := Must(db.Table("folders").
		Where(
			"id = ? AND deleted_at IS NOT NULL AND expires_at > CURRENT_TIMESTAMP(6)",
			folderID,
		).
		Updates(map[string]any{
			"deleted_at": nil,
			"deleted_by": nil,
			"expires_at": nil,
			"updated_at": gorm.Expr("updated_at"),
		}))

	return result.RowsAffected == 1
}

// TrashDocumentByKey 查询文档及其所属文件夹的删除状态。
func TrashDocumentByKey(db *gorm.DB, key string) shared.Row {
	return One(db.Table("documents AS d").
		Select(`
			d.id,
			d.file_key,
            d.creator_id,
            d.deleted_by,
			d.deleted_at,
			f.deleted_at AS folder_deleted_at,
			p.project_key
		`).
		Joins("JOIN folders f ON f.id = d.folder_id").
		Joins("JOIN projects p ON p.id = f.project_id").
		Where("d.file_key = ?", key))
}

// TrashRestoreDocument 恢复尚未到期的文档，返回是否成功。
func TrashRestoreDocument(db *gorm.DB, documentID any) bool {
	result := Must(db.Table("documents").
		Where(
			"id = ? AND deleted_at IS NOT NULL AND expires_at > CURRENT_TIMESTAMP(6)",
			documentID,
		).
		Updates(map[string]any{
			"deleted_at": nil,
			"deleted_by": nil,
			"expires_at": nil,
			"updated_at": gorm.Expr("updated_at"),
		}))

	return result.RowsAffected == 1
}

// trashListQuery 合并指定项目中未到期的回收站记录。
func trashListQuery(db *gorm.DB, projectIDs []int64, deletedBy string) *gorm.DB {
	documents := db.Table("documents AS d").
		Select(`
			'document' AS item_type,
			d.file_key AS resource_key,
			d.file_name AS name,
			t.team_key,
			p.project_key,
			f.folder_key,
			d.deleted_by,
			u.name AS deleted_by_name,
			d.deleted_at,
			d.expires_at,
			(f.deleted_at IS NULL) AS can_restore,
			NULL AS document_count
		`).
		Joins("JOIN folders f ON f.id = d.folder_id").
		Joins("JOIN projects p ON p.id = f.project_id").
		Joins("JOIN teams t ON t.id = p.team_id").
		Joins("LEFT JOIN users u ON u.id = d.deleted_by").
		Where(
			"p.id IN ? AND d.deleted_at IS NOT NULL AND d.expires_at > CURRENT_TIMESTAMP(6)",
			projectIDs,
		)

	folders := db.Table("folders AS f").
		Select(`
			'folder' AS item_type,
			f.folder_key AS resource_key,
			f.name,
			t.team_key,
			p.project_key,
			NULL AS folder_key,
			f.deleted_by,
			u.name AS deleted_by_name,
			f.deleted_at,
			f.expires_at,
			1 AS can_restore,
			(SELECT COUNT(*) FROM documents d WHERE d.folder_id = f.id) AS document_count
		`).
		Joins("JOIN projects p ON p.id = f.project_id").
		Joins("JOIN teams t ON t.id = p.team_id").
		Joins("LEFT JOIN users u ON u.id = f.deleted_by").
		Where(
			"p.id IN ? AND f.deleted_at IS NOT NULL AND f.expires_at > CURRENT_TIMESTAMP(6)",
			projectIDs,
		)

	if deletedBy != "" {
		documents = documents.Where("d.deleted_by=?", deletedBy)
		folders = folders.Where("f.deleted_by=?", deletedBy)
	}
	return db.Table("(? UNION ALL ?) AS trash_items", documents, folders)
}

// TrashList 返回分页结果和总数。
// projectIDs 必须由 Service 筛选为当前用户具有项目写权限的项目。
func TrashList(db *gorm.DB, projectIDs []int64, deletedBy string, limit, offset int) ([]shared.Row, int64) {
	if len(projectIDs) == 0 {
		return []shared.Row{}, 0
	}

	var total int64
	Must(trashListQuery(db, projectIDs, deletedBy).Count(&total))

	items := Rows(trashListQuery(db, projectIDs, deletedBy).
		Order("deleted_at DESC, item_type ASC, resource_key ASC").
		Limit(limit).
		Offset(offset))

	return items, total
}

// TrashExpiredDocumentIDs 分批查询已到期的文档 ID。
func TrashExpiredDocumentIDs(db *gorm.DB, afterID int64) []int64 {
	var ids []int64

	Must(db.Table("documents").
		Where(
			"id > ? AND deleted_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP(6)",
			afterID,
		).
		Order("id").
		Limit(100).
		Pluck("id", &ids))

	return ids
}

// TrashExpiredFolderIDs 分批查询已到期的文件夹 ID。
func TrashExpiredFolderIDs(db *gorm.DB, afterID int64) []int64 {
	var ids []int64

	Must(db.Table("folders").
		Where(
			"id > ? AND deleted_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP(6)",
			afterID,
		).
		Order("id").
		Limit(100).
		Pluck("id", &ids))

	return ids
}

// TrashPurgeExpiredDocument 清理仍处于到期状态的文档。
// 调用方必须持有工作区写事务。
func TrashPurgeExpiredDocument(db *gorm.DB, documentID int64) bool {
	document := One(db.Table("documents").
		Select("id, file_key").
		Where(
			"id = ? AND deleted_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP(6)",
			documentID,
		))
	if document == nil {
		return false
	}

	WorkspaceDeleteDocument(db, document["id"], shared.String(document["file_key"]))
	return true
}

// TrashPurgeExpiredFolder 清理仍处于到期状态的文件夹及其内容。
// 调用方必须持有工作区写事务。
func TrashPurgeExpiredFolder(db *gorm.DB, folderID int64) bool {
	folder := One(db.Table("folders").
		Select("id, project_id").
		Where(
			"id = ? AND deleted_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP(6)",
			folderID,
		))
	if folder == nil {
		return false
	}

	WorkspaceDeleteFolder(db, folder["project_id"], folder["id"])
	return true
}

func AllTrashFolders(db *gorm.DB, projectIDs []int64) []shared.Row {
	if len(projectIDs) == 0 {
		return []shared.Row{}
	}
	return Rows(db.Table("folders").Select("id,project_id").Where("project_id IN ? AND deleted_at IS NOT NULL", projectIDs))
}
func AllTrashDocuments(db *gorm.DB, projectIDs []int64) []shared.Row {
	if len(projectIDs) == 0 {
		return []shared.Row{}
	}
	return Rows(db.Table("documents d").Select("d.id,d.file_key,f.deleted_at AS folder_deleted_at").Joins("JOIN folders f ON f.id=d.folder_id").Where("f.project_id IN ? AND d.deleted_at IS NOT NULL", projectIDs))
}
