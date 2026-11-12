package repository

import (
	"voex-server/internal/dbschema"
	"voex-server/internal/model"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

// TrashFolderByKey 查询文件夹及其删除状态，供回收站操作使用。
func TrashFolderByKey(db *gorm.DB, key string) shared.Row {
	ft := dbschema.Folders
	pt := dbschema.Projects
	folder := One(
		db.Table(ft.Name).
			Select(ft.Columns.ID+
				","+
				ft.Columns.PROJECT_ID+
				","+
				ft.Columns.DELETED_AT+
				","+
				ft.Columns.DELETED_BY).
			Where(&model.Folder{FolderKey: key}, ft.Columns.FOLDER_KEY),
	)
	if folder == nil {
		return nil
	}
	project := One(
		db.Table(pt.Name).
			Select(pt.Columns.PROJECT_KEY).
			Where(pt.Columns.ID+"=?", folder[ft.Columns.PROJECT_ID]),
	)
	if project == nil {
		return nil
	}
	folder[pt.Columns.PROJECT_KEY] = project[pt.Columns.PROJECT_KEY]
	return folder
}

// TrashRestoreFolder 恢复尚未到期的文件夹，返回是否成功。
func TrashRestoreFolder(db *gorm.DB, folderID any) bool {
	ft := dbschema.Folders
	result := Must(db.Table(ft.Name).
		Where(
			ft.Columns.ID+
				" = ? AND "+
				ft.Columns.DELETED_AT+
				" IS NOT NULL AND "+
				ft.Columns.EXPIRES_AT+
				" > CURRENT_TIMESTAMP(6)",
			folderID,
		).
		Updates(map[string]any{
			ft.Columns.DELETED_AT: nil,
			ft.Columns.DELETED_BY: nil,
			ft.Columns.EXPIRES_AT: nil,
			ft.Columns.UPDATED_AT: gorm.Expr(ft.Columns.UPDATED_AT),
		}))

	return result.RowsAffected == 1
}

// TrashDocumentByKey 查询文档及其所属文件夹的删除状态。
func TrashDocumentByKey(db *gorm.DB, key string) shared.Row {
	dt := dbschema.Documents
	ft := dbschema.Folders
	pt := dbschema.Projects
	doc := One(
		db.Table(dt.Name).
			Select(dt.Columns.ID+
				","+
				dt.Columns.FILE_KEY+
				","+
				dt.Columns.CREATOR_ID+
				","+
				dt.Columns.DELETED_BY+
				","+
				dt.Columns.DELETED_AT+
				","+
				dt.Columns.FOLDER_ID).
			Where(&model.Document{FileKey: key}, dt.Columns.FILE_KEY),
	)
	if doc == nil {
		return nil
	}
	folder := One(
		db.Table(ft.Name).
			Select(ft.Columns.PROJECT_ID+","+ft.Columns.DELETED_AT).
			Where(ft.Columns.ID+"=?", doc[dt.Columns.FOLDER_ID]),
	)
	if folder == nil {
		return nil
	}
	project := One(
		db.Table(pt.Name).
			Select(pt.Columns.PROJECT_KEY).
			Where(pt.Columns.ID+"=?", folder[ft.Columns.PROJECT_ID]),
	)
	if project == nil {
		return nil
	}
	doc["folder_deleted_at"],
		doc[pt.Columns.PROJECT_KEY] =
		folder[ft.Columns.DELETED_AT],
		project[pt.Columns.PROJECT_KEY]
	delete(doc, dt.Columns.FOLDER_ID)
	return doc
}

// TrashRestoreDocument 恢复尚未到期的文档，返回是否成功。
func TrashRestoreDocument(db *gorm.DB, documentID any) bool {
	dt := dbschema.Documents
	result := Must(db.Table(dt.Name).
		Where(
			dt.Columns.ID+
				" = ? AND "+
				dt.Columns.DELETED_AT+
				" IS NOT NULL AND "+
				dt.Columns.EXPIRES_AT+
				" > CURRENT_TIMESTAMP(6)",
			documentID,
		).
		Updates(map[string]any{
			dt.Columns.DELETED_AT: nil,
			dt.Columns.DELETED_BY: nil,
			dt.Columns.EXPIRES_AT: nil,
			dt.Columns.UPDATED_AT: gorm.Expr(dt.Columns.UPDATED_AT),
		}))

	return result.RowsAffected == 1
}

// trashListQuery 只合并回收站主记录，项目和团队已由 TrashList 校验。
// 文件夹子查询保留分页前的项目筛选，避免展开项目下全部文件夹 ID。
func trashListQuery(db *gorm.DB, projectIDs []int64, deletedBy string) *gorm.DB {
	dt, ft := dbschema.Documents, dbschema.Folders
	folderIDs := db.Table(dbschema.Folders.Name).Select(dbschema.Folders.Columns.ID).
		Where(dbschema.Folders.Columns.PROJECT_ID+" IN ?", projectIDs)
	documents := db.Table(dt.Name).
		Select(
			dbschema.List(
				"'document' AS item_type",
				dt.Columns.FILE_KEY+
					" AS resource_key",
				dt.Columns.FILE_NAME+
					" AS name",
				dt.Columns.FOLDER_ID+
					" AS related_folder_id",
				dt.Columns.DELETED_BY,
				dt.Columns.DELETED_AT,
				dt.Columns.EXPIRES_AT,
			),
		).
		Where(
			dt.Columns.FOLDER_ID+
				" IN (?) AND "+
				dt.Columns.DELETED_AT+
				" IS NOT NULL AND "+
				dt.Columns.EXPIRES_AT+
				" > CURRENT_TIMESTAMP(6)",
			folderIDs,
		)
	folders := db.Table(ft.Name).
		Select(
			dbschema.List(
				"'folder' AS item_type",
				ft.Columns.FOLDER_KEY+
					" AS resource_key",
				ft.Columns.NAME,
				ft.Columns.ID+
					" AS related_folder_id",
				ft.Columns.DELETED_BY,
				ft.Columns.DELETED_AT,
				ft.Columns.EXPIRES_AT,
			),
		).
		Where(
			ft.Columns.PROJECT_ID+
				" IN ? AND "+
				ft.Columns.DELETED_AT+
				" IS NOT NULL AND "+
				ft.Columns.EXPIRES_AT+
				" > CURRENT_TIMESTAMP(6)",
			projectIDs,
		)
	if deletedBy != "" {
		documents = documents.Where(&model.Document{DeletedBy: &deletedBy}, dt.Columns.DELETED_BY)
		folders = folders.Where(&model.Folder{DeletedBy: &deletedBy}, ft.Columns.DELETED_BY)
	}
	return db.Table("(? UNION ALL ?) AS trash_items", documents, folders)
}

// TrashList 返回分页结果和总数。
// projectIDs 必须由 Service 筛选为当前用户可见的项目。
func TrashList(
	db *gorm.DB,
	projectIDs []int64,
	deletedBy string,
	limit, offset int,
) ([]shared.Row, int64) {
	dt := dbschema.Documents
	ft := dbschema.Folders
	pt := dbschema.Projects
	tt := dbschema.Teams
	ut := dbschema.Users
	if len(projectIDs) == 0 {
		return []shared.Row{}, 0
	}
	projectKeys := make([]any, 0, len(projectIDs))
	seen := make(map[int64]bool, len(projectIDs))
	for _, id := range projectIDs {
		if !seen[id] {
			seen[id] = true
			projectKeys = append(projectKeys, id)
		}
	}
	projects := queryRowsIn(
		db.Table(pt.Name).Select(pt.Columns.ID+","+pt.Columns.PROJECT_KEY+","+pt.Columns.TEAM_ID),
		pt.Columns.ID,
		projectKeys,
	)
	teams := rowsByKey(
		db.Table(tt.Name).Select(tt.Columns.ID+","+tt.Columns.TEAM_KEY),
		tt.Columns.ID,
		rowValues(projects, pt.Columns.TEAM_ID),
	)
	projectsByID := make(map[string]shared.Row, len(projects))
	validProjectIDs := make([]int64, 0, len(projects))
	for _, project := range projects {
		team := teams[shared.String(project[pt.Columns.TEAM_ID])]
		if team == nil {
			continue
		}
		project[tt.Columns.TEAM_KEY] = team[tt.Columns.TEAM_KEY]
		projectsByID[shared.String(project[pt.Columns.ID])] = project
		validProjectIDs = append(validProjectIDs, shared.Int64(project[pt.Columns.ID]))
	}
	if len(validProjectIDs) == 0 {
		return []shared.Row{}, 0
	}

	var total int64
	Must(trashListQuery(db, validProjectIDs, deletedBy).Count(&total))
	items := Rows(trashListQuery(db, validProjectIDs, deletedBy).
		Order(dt.Columns.DELETED_AT + " DESC, item_type ASC, resource_key ASC").
		Limit(limit).Offset(offset))
	users := rowsByKey(
		db.Table(ut.Name).Select(ut.Columns.ID+","+ut.Columns.NAME),
		ut.Columns.ID,
		rowValues(items, dt.Columns.DELETED_BY),
	)
	folders := rowsByKey(
		db.Table(ft.Name).
			Select(ft.Columns.ID+
				","+
				ft.Columns.PROJECT_ID+
				","+
				ft.Columns.FOLDER_KEY+
				","+
				ft.Columns.DELETED_AT),
		ft.Columns.ID,
		rowValues(items, "related_folder_id"),
	)
	folderItems := make([]shared.Row, 0)
	for _, item := range items {
		folder := folders[shared.String(item["related_folder_id"])]
		project := projectsByID[shared.String(folder[ft.Columns.PROJECT_ID])]
		item["team_key"],
			item["project_key"] =
			project[tt.Columns.TEAM_KEY],
			project[pt.Columns.PROJECT_KEY]
		item["deleted_by_name"] = users[shared.String(item["deleted_by"])][ut.Columns.NAME]
		item["folder_key"], item["document_count"] = nil, nil
		item["can_restore"] = int64(1)
		if shared.String(item["item_type"]) == "folder" {
			folderItems = append(folderItems, item)
		} else {
			item["folder_key"] = folder[ft.Columns.FOLDER_KEY]
			if folder[ft.Columns.DELETED_AT] != nil {
				item["can_restore"] = int64(0)
			}
		}
	}
	counts := rowsByKey(
		db.Table(dt.Name).
			Select(dt.Columns.FOLDER_ID+",COUNT(*) AS total").
			Group(dt.Columns.FOLDER_ID),
		dt.Columns.FOLDER_ID,
		rowValues(folderItems, "related_folder_id"),
	)
	for _, item := range folderItems {
		item["document_count"] = shared.Int64(
			counts[shared.String(item["related_folder_id"])]["total"],
		)
	}
	for _, item := range items {
		delete(item, "related_folder_id")
	}
	return items, total
}

// TrashExpiredDocumentIDs 分批查询已到期的文档 ID。
func TrashExpiredDocumentIDs(db *gorm.DB, afterID int64) []int64 {
	dt := dbschema.Documents
	var ids []int64

	Must(db.Table(dt.Name).
		Where(
			dt.Columns.ID+
				" > ? AND "+
				dt.Columns.DELETED_AT+
				" IS NOT NULL AND "+
				dt.Columns.EXPIRES_AT+
				" <= CURRENT_TIMESTAMP(6)",
			afterID,
		).
		Order(dt.Columns.ID).
		Limit(100).
		Pluck(dt.Columns.ID, &ids))

	return ids
}

// TrashExpiredFolderIDs 分批查询已到期的文件夹 ID。
func TrashExpiredFolderIDs(db *gorm.DB, afterID int64) []int64 {
	ft := dbschema.Folders
	var ids []int64

	Must(db.Table(ft.Name).
		Where(
			ft.Columns.ID+
				" > ? AND "+
				ft.Columns.DELETED_AT+
				" IS NOT NULL AND "+
				ft.Columns.EXPIRES_AT+
				" <= CURRENT_TIMESTAMP(6)",
			afterID,
		).
		Order(ft.Columns.ID).
		Limit(100).
		Pluck(ft.Columns.ID, &ids))

	return ids
}

// TrashPurgeExpiredDocument 清理仍处于到期状态的文档。
// 调用方必须持有工作区写事务。
func TrashPurgeExpiredDocument(db *gorm.DB, documentID int64) bool {
	dt := dbschema.Documents
	document := One(db.Table(dt.Name).
		Select(dt.Columns.ID+", "+dt.Columns.FILE_KEY).
		Where(
			dt.Columns.ID+
				" = ? AND "+
				dt.Columns.DELETED_AT+
				" IS NOT NULL AND "+
				dt.Columns.EXPIRES_AT+
				" <= CURRENT_TIMESTAMP(6)",
			documentID,
		),
	)
	if document == nil {
		return false
	}

	WorkspaceDeleteDocument(
		db,
		document[dt.Columns.ID],
		shared.String(document[dt.Columns.FILE_KEY]),
	)
	return true
}

// TrashPurgeExpiredFolder 清理仍处于到期状态的文件夹及其内容。
// 调用方必须持有工作区写事务。
func TrashPurgeExpiredFolder(db *gorm.DB, folderID int64) bool {
	ft := dbschema.Folders
	folder := One(db.Table(ft.Name).
		Select(ft.Columns.ID+", "+ft.Columns.PROJECT_ID).
		Where(
			ft.Columns.ID+
				" = ? AND "+
				ft.Columns.DELETED_AT+
				" IS NOT NULL AND "+
				ft.Columns.EXPIRES_AT+
				" <= CURRENT_TIMESTAMP(6)",
			folderID,
		),
	)
	if folder == nil {
		return false
	}

	WorkspaceDeleteFolder(db, folder[ft.Columns.PROJECT_ID], folder[ft.Columns.ID])
	return true
}

func AllTrashFolders(db *gorm.DB, projectIDs []int64) []shared.Row {
	ft := dbschema.Folders
	if len(projectIDs) == 0 {
		return []shared.Row{}
	}
	return Rows(
		db.Table(ft.Name).
			Select(ft.Columns.ID+","+ft.Columns.PROJECT_ID).
			Where(ft.Columns.PROJECT_ID+
				" IN ? AND "+
				ft.Columns.DELETED_AT+
				" IS NOT NULL", projectIDs),
	)
}
func AllTrashDocuments(db *gorm.DB, projectIDs []int64) []shared.Row {
	dt := dbschema.Documents
	ft := dbschema.Folders
	if len(projectIDs) == 0 {
		return []shared.Row{}
	}
	// folders.project_id and documents.folder_id both have left-prefix indexes.
	// folders.project_id 和 documents.folder_id 都具备以该列为最左前缀的索引。
	folders := Rows(
		db.Table(ft.Name).
			Select(ft.Columns.ID+","+ft.Columns.DELETED_AT).
			Where(ft.Columns.PROJECT_ID+" IN ?", projectIDs),
	)
	byID := make(map[string]shared.Row, len(folders))
	for _, folder := range folders {
		byID[shared.String(folder[ft.Columns.ID])] = folder
	}
	documents := queryRowsIn(
		db.Table(dt.Name).
			Select(dt.Columns.ID+","+dt.Columns.FILE_KEY+","+dt.Columns.FOLDER_ID).
			Where(dt.Columns.DELETED_AT+" IS NOT NULL"),
		dt.Columns.FOLDER_ID,
		rowValues(folders, ft.Columns.ID),
	)
	for _, doc := range documents {
		doc["folder_deleted_at"] = byID[shared.String(
			doc[dt.Columns.FOLDER_ID],
		)][ft.Columns.DELETED_AT]
		delete(doc, dt.Columns.FOLDER_ID)
	}
	return documents
}
