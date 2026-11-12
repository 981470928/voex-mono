package repository

import (
	"voex-server/internal/dbschema"
	"voex-server/internal/model"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

var documentFields = func() string {
	dt := dbschema.Documents
	return dbschema.List(
		dt.Columns.ID,
		dt.Columns.FILE_KEY,
		dt.Columns.FILE_NAME,
		dt.Columns.CREATED_AT,
		dt.Columns.UPDATED_AT,
		dt.Columns.CREATOR_ID,
		dt.Columns.UPDATED_BY,
		dt.Columns.UPDATED_BY_ANONYMOUS,
		dt.Columns.REVISION,
	)
}()
var DocumentColumns = func() string {
	dt, ft, pt, tt := dbschema.Documents, dbschema.Folders, dbschema.Projects, dbschema.Teams
	dq, fq, pq := dt.Qualified(), ft.Qualified(), pt.Qualified()
	// 最近文件也复用此投影，file_name 与 recent_files 同名，需明确来源。
	return dbschema.List(dq.Columns.ID, dt.Columns.FILE_KEY, dq.Columns.FILE_NAME,
		dq.Columns.CREATED_AT, dq.Columns.UPDATED_AT, dq.Columns.CREATOR_ID,
		dt.Columns.UPDATED_BY, dt.Columns.UPDATED_BY_ANONYMOUS, dt.Columns.REVISION,
		ft.Columns.PROJECT_ID, pt.Columns.PROJECT_KEY, pq.Columns.NAME+" AS project_name",
		ft.Columns.FOLDER_KEY, fq.Columns.NAME+" AS folder_name", tt.Columns.TEAM_KEY)
}()

// DocumentQuery keeps hierarchy predicates in SQL before ordering/pagination.
// Display-only user fields are loaded once per batch by documentRows.
// DocumentQuery 在排序和分页前，将层级筛选条件保留在 SQL 中。
// 仅用于展示的用户字段由 documentRows 每批加载一次。
func DocumentQuery(db *gorm.DB, content bool) *gorm.DB {
	dt, ft, pt, tt := dbschema.Documents, dbschema.Folders, dbschema.Projects, dbschema.Teams
	dq, fq, pq, tq := dt.Qualified(), ft.Qualified(), pt.Qualified(), tt.Qualified()
	columns := DocumentColumns
	if content {
		columns = dbschema.List(columns, dt.Columns.FILE_CONTENT)
	}
	return db.Table(dt.Name).Select(columns).
		Joins("JOIN " + ft.Name + " ON " + fq.Columns.ID + "=" + dt.Columns.FOLDER_ID).
		Joins("JOIN " + pt.Name + " ON " + pq.Columns.ID + "=" + ft.Columns.PROJECT_ID).
		Joins("JOIN " + tt.Name + " ON " + tq.Columns.ID + "=" + pt.Columns.TEAM_ID).
		Where(dq.Columns.DELETED_AT + " IS NULL AND " + fq.Columns.DELETED_AT + " IS NULL")
}

func documentAuthors(db *gorm.DB, rows []shared.Row) []shared.Row {
	dt := dbschema.Documents
	ut := dbschema.Users
	users := rowsByKey(
		db.Table(ut.Name).Select(ut.Columns.ID+","+ut.Columns.NAME+","+ut.Columns.AVATOR),
		ut.Columns.ID,
		rowValues(rows, dt.Columns.CREATOR_ID, dt.Columns.UPDATED_BY),
	)
	for _, row := range rows {
		creator := users[shared.String(row[dt.Columns.CREATOR_ID])]
		editor := users[shared.String(row[dt.Columns.UPDATED_BY])]
		row["creator_name"],
			row["creator_avator"] =
			creator[ut.Columns.NAME],
			creator[ut.Columns.AVATOR]
		row["updated_by_name"] = editor[ut.Columns.NAME]
	}
	return rows
}

func documentRows(db *gorm.DB, query *gorm.DB) []shared.Row {
	return documentAuthors(db, Rows(query))
}

func DocumentByKey(db *gorm.DB, key string, content bool) shared.Row {
	dt := dbschema.Documents
	ft := dbschema.Folders
	pt := dbschema.Projects
	tt := dbschema.Teams
	columns := dbschema.List(documentFields, dt.Columns.FOLDER_ID)
	if content {
		columns = dbschema.List(columns, dt.Columns.FILE_CONTENT)
	}
	doc := One(
		db.Table(dt.Name).
			Select(columns).
			Where(dt.Columns.FILE_KEY+"=? AND "+dt.Columns.DELETED_AT+" IS NULL", key),
	)
	if doc == nil {
		return nil
	}
	folder := One(
		db.Table(ft.Name).
			Select(ft.Columns.PROJECT_ID+","+ft.Columns.FOLDER_KEY+","+ft.Columns.NAME).
			Where(ft.Columns.ID+
				"=? AND "+
				ft.Columns.DELETED_AT+
				" IS NULL", doc[dt.Columns.FOLDER_ID]),
	)
	if folder == nil {
		return nil
	}
	project := One(
		db.Table(pt.Name).
			Select(pt.Columns.PROJECT_KEY+","+pt.Columns.NAME+","+pt.Columns.TEAM_ID).
			Where(pt.Columns.ID+"=?", folder[ft.Columns.PROJECT_ID]),
	)
	if project == nil {
		return nil
	}
	team := One(
		db.Table(tt.Name).
			Select(tt.Columns.TEAM_KEY).
			Where(tt.Columns.ID+"=?", project[pt.Columns.TEAM_ID]),
	)
	if team == nil {
		return nil
	}
	doc[ft.Columns.PROJECT_ID],
		doc[pt.Columns.PROJECT_KEY],
		doc["project_name"] =
		folder[ft.Columns.PROJECT_ID],
		project[pt.Columns.PROJECT_KEY],
		project[pt.Columns.NAME]
	doc[ft.Columns.FOLDER_KEY],
		doc["folder_name"],
		doc[tt.Columns.TEAM_KEY] =
		folder[ft.Columns.FOLDER_KEY],
		folder[ft.Columns.NAME],
		team[tt.Columns.TEAM_KEY]
	delete(doc, dt.Columns.FOLDER_ID)
	return firstRow(documentAuthors(db, []shared.Row{doc}))
}

func WorkspaceProjectPermission(db *gorm.DB, userID, key string) shared.Row {
	pt,
		tt,
		mt,
		pmt :=
		dbschema.Projects,
		dbschema.Teams,
		dbschema.TeamMembers,
		dbschema.ProjectMembers
	pq, tq, mq := pt.Qualified(), tt.Qualified(), mt.Qualified()
	explicit := "EXISTS(SELECT 1 FROM " +
		pmt.Name +
		" WHERE " +
		pmt.Columns.PROJECT_ID +
		"=" +
		pq.Columns.ID +
		" AND " + pmt.Columns.USER_ID + "=?) AS explicit_member"
	return One(
		db.Table(pt.Name).
			Select(dbschema.List(
				tt.Columns.OWNER_ID,
				mt.Columns.USER_ID,
				mt.Columns.ROLE,
				pq.Columns.PRIVILEGES,
				explicit,
			), userID).
			Joins("JOIN "+tt.Name+" ON "+tq.Columns.ID+"="+pq.Columns.TEAM_ID).
			Joins("LEFT JOIN "+
				mt.Name+
				" ON "+
				mq.Columns.TEAM_ID+
				"="+
				tq.Columns.ID+
				" AND "+
				mt.Columns.USER_ID+
				"=?", userID).
			Where(pt.Columns.PROJECT_KEY+"=?", key),
	)
}

func workspaceProjects(db *gorm.DB, query *gorm.DB) []shared.Row {
	pt := dbschema.Projects
	tt := dbschema.Teams
	projects := Rows(query)
	teams := rowsByKey(
		db.Table(tt.Name).Select(tt.Columns.ID+","+tt.Columns.TEAM_KEY),
		tt.Columns.ID,
		rowValues(projects, pt.Columns.TEAM_ID),
	)
	result := make([]shared.Row, 0, len(projects))
	for _, project := range projects {
		if team := teams[shared.String(project[pt.Columns.TEAM_ID])]; team != nil {
			project[tt.Columns.TEAM_KEY] = team[tt.Columns.TEAM_KEY]
			result = append(result, project)
		}
	}
	return result
}

func WorkspaceProjectByKey(db *gorm.DB, key string) shared.Row {
	pt := dbschema.Projects
	return firstRow(
		workspaceProjects(
			db,
			db.Table(pt.Name).
				Where(&model.Project{ProjectKey: key}, pt.Columns.PROJECT_KEY).
				Limit(1),
		),
	)
}

func WorkspaceProjectByID(db *gorm.DB, id any) shared.Row {
	pt := dbschema.Projects
	return firstRow(workspaceProjects(db, db.Table(pt.Name).Where(pt.Columns.ID+"=?", id).Limit(1)))
}

func WorkspaceProjects(db *gorm.DB, teamID any) []shared.Row {
	pt := dbschema.Projects
	return workspaceProjects(
		db,
		db.Table(pt.Name).
			Where(pt.Columns.TEAM_ID+"=?", teamID).
			Order(pt.Columns.CREATED_AT+","+pt.Columns.ID),
	)
}

func WorkspaceFolderByKey(db *gorm.DB, key string) shared.Row {
	ft := dbschema.Folders
	return One(db.Table(ft.Name).
		Where(ft.Columns.FOLDER_KEY+" = ? AND "+ft.Columns.DELETED_AT+" IS NULL", key))
}

func WorkspaceFolders(db *gorm.DB, projectID any) []shared.Row {
	ft := dbschema.Folders
	return Rows(db.Table(ft.Name).
		Where(ft.Columns.PROJECT_ID+" = ? AND "+ft.Columns.DELETED_AT+" IS NULL", projectID).
		Order(ft.Columns.CREATED_AT + "," + ft.Columns.ID))
}

func WorkspaceFirstRoot(db *gorm.DB, projectID any) shared.Row {
	ft := dbschema.Folders
	return One(db.Table(ft.Name).
		Where(ft.Columns.PROJECT_ID+
			" = ? AND "+
			ft.Columns.PARENT_ID+
			" IS NULL AND "+
			ft.Columns.DELETED_AT+
			" IS NULL", projectID).
		Order(ft.Columns.CREATED_AT + "," + ft.Columns.ID))
}

func WorkspaceInsertProject(db *gorm.DB, key, name, creatorID string, teamID any) shared.Row {
	pt := dbschema.Projects
	Must(db.Table(pt.Name).Create(map[string]any{
		pt.Columns.PROJECT_KEY: key, pt.Columns.NAME: name, pt.Columns.CREATOR_ID: creatorID,
		pt.Columns.TEAM_ID: teamID, pt.Columns.PRIVILEGES: `{"mode":"restricted"}`,
	}))
	return WorkspaceProjectByKey(db, key)
}

func WorkspaceInsertFolder(db *gorm.DB, key string, projectID any, name string) shared.Row {
	ft := dbschema.Folders
	Must(db.Table(ft.Name).Create(map[string]any{
		ft.Columns.FOLDER_KEY: key, ft.Columns.PROJECT_ID: projectID, ft.Columns.PARENT_ID: nil,
		ft.Columns.NAME: name, ft.Columns.PRIVILEGES: `{"mode":"inherit"}`,
	}))
	return WorkspaceFolderByKey(db, key)
}

func WorkspaceRenameProject(db *gorm.DB, id any, name string) {
	pt := dbschema.Projects
	Must(db.Table(pt.Name).Where(pt.Columns.ID+"=?", id).Update(pt.Columns.NAME, name))
}

func WorkspaceProjectHasFolders(db *gorm.DB, id any) bool {
	ft := dbschema.Folders
	return One(db.Table(ft.Name).Select(ft.Columns.ID).Where(ft.Columns.PROJECT_ID+"=?", id)) != nil
}

func WorkspaceDeleteProject(db *gorm.DB, id any) {
	pt := dbschema.Projects
	workspaceDeleteFolders(db, id, nil)
	Must(db.Table(pt.Name).Where(pt.Columns.ID+"=?", id).Delete(&map[string]any{}))
}

func WorkspaceRenameFolder(db *gorm.DB, id any, name string) {
	ft := dbschema.Folders
	Must(db.Table(ft.Name).Where(ft.Columns.ID+"=?", id).Update(ft.Columns.NAME, name))
}

func WorkspaceFolderHasChildren(db *gorm.DB, projectID, id any) bool {
	dt := dbschema.Documents
	ft := dbschema.Folders
	return One(db.Table(dt.Name).Select(dt.Columns.ID).
		Where(dt.Columns.FOLDER_ID+" = ? AND "+dt.Columns.DELETED_AT+" IS NULL", id)) != nil ||
		One(db.Table(ft.Name).Select(ft.Columns.ID).
			Where(ft.Columns.PROJECT_ID+
				" = ? AND "+
				ft.Columns.PARENT_ID+
				" = ? AND "+
				ft.Columns.DELETED_AT+
				" IS NULL", projectID, id),
		) != nil
}

func WorkspaceDeleteFolder(db *gorm.DB, projectID, id any) {
	workspaceDeleteFolders(db, projectID, id)
}

// The caller holds the workspace write lock and has authorized the project.
// A nil root deletes every folder in the project; otherwise only that subtree.
// 调用方已持有工作区写锁，并已完成项目授权检查。
// root 为 nil 时删除项目中的全部文件夹，否则仅删除该子树。
func workspaceDeleteFolders(db *gorm.DB, projectID, rootID any) {
	dt := dbschema.Documents
	ft := dbschema.Folders
	folders := Rows(
		db.Table(ft.Name).
			Select(ft.Columns.ID+","+ft.Columns.PARENT_ID).
			Where(ft.Columns.PROJECT_ID+"=?", projectID),
	)
	children := make(map[int64][]shared.Row, len(folders))
	ordered := make([]shared.Row, 0, len(folders))
	for _, folder := range folders {
		children[shared.Int64(folder[ft.Columns.PARENT_ID])] = append(
			children[shared.Int64(folder[ft.Columns.PARENT_ID])],
			folder,
		)
		if (rootID == nil && folder[ft.Columns.PARENT_ID] == nil) ||
			(rootID != nil && shared.Int64(folder[ft.Columns.ID]) == shared.Int64(rootID)) {
			ordered = append(ordered, folder)
		}
	}
	seen := make(map[int64]bool, len(folders))
	for index := 0; index < len(ordered); index++ {
		id := shared.Int64(ordered[index][ft.Columns.ID])
		if seen[id] {
			panic("cyclic folder hierarchy")
		}
		seen[id] = true
		ordered = append(ordered, children[id]...)
	}
	if rootID == nil && len(ordered) != len(folders) {
		panic("invalid folder hierarchy")
	}
	// Reverse breadth-first order satisfies the restrictive parent foreign key.
	// 逆序遍历广度优先结果，以满足父目录外键的删除限制。
	for index := len(ordered) - 1; index >= 0; index-- {
		id := ordered[index][ft.Columns.ID]
		documents := Rows(
			db.Table(dt.Name).
				Select(dt.Columns.ID+","+dt.Columns.FILE_KEY).
				Where(dt.Columns.FOLDER_ID+"=?", id),
		)
		for _, document := range documents {
			WorkspaceDeleteDocument(
				db,
				document[dt.Columns.ID],
				shared.String(document[dt.Columns.FILE_KEY]),
			)
		}
		Must(
			db.Table(ft.Name).
				Where(ft.Columns.PROJECT_ID+"=? AND "+ft.Columns.ID+"=?", projectID, id).
				Delete(&map[string]any{}),
		)
	}
}

func WorkspaceProjectDocuments(db *gorm.DB, projectID any) []shared.Row {
	ft, dq := dbschema.Folders, dbschema.Documents.Qualified()
	return documentRows(db, DocumentQuery(db, false).Where(ft.Columns.PROJECT_ID+"=?", projectID).
		Order(dbschema.List(dq.Columns.CREATED_AT, dq.Columns.ID)))
}

func WorkspaceDocuments(db *gorm.DB, userID, code string) []shared.Row {
	mt, dt := dbschema.TeamMembers, dbschema.Documents
	pq, dq := dbschema.Projects.Qualified(), dt.Qualified()
	query := DocumentQuery(
		db,
		false,
	).Where("EXISTS (SELECT 1 FROM "+
		mt.Name+
		" WHERE "+
		mt.Columns.TEAM_ID+
		"="+
		pq.Columns.TEAM_ID+
		" AND "+
		mt.Columns.USER_ID+
		"=?)", userID)
	if code != "" {
		query = query.Where(dt.Columns.FILE_NAME+" LIKE ?", "%"+code+"%")
	}
	return documentRows(db, query.Order(dbschema.List(dq.Columns.CREATED_AT, dq.Columns.ID)))
}

// searchQuery 限定团队与可见性：团队成员可读团队内全部文档，document_access 授权为跨团队放开预留。
func searchQuery(db *gorm.DB, userID string, teamID any, phrase string) *gorm.DB {
	dt,
		pt,
		mt,
		at :=
		dbschema.Documents,
		dbschema.Projects,
		dbschema.TeamMembers,
		dbschema.DocumentAccess
	dq, pq := dt.Qualified(), pt.Qualified()
	member := "EXISTS (SELECT 1 FROM " +
		mt.Name +
		" WHERE " +
		mt.Columns.TEAM_ID +
		"=" +
		pq.Columns.TEAM_ID +
		" AND " +
		mt.Columns.USER_ID +
		"=?)"
	access := "EXISTS (SELECT 1 FROM " +
		at.Name +
		" WHERE " +
		at.Columns.DOCUMENT_ID +
		"=" +
		dq.Columns.ID +
		" AND " + at.Columns.USER_ID + "=? AND " + at.Columns.PERMISSION + " IN ('read','edit'))"
	return DocumentQuery(db, false).
		Where("MATCH("+dbschema.List(
			dt.Columns.FILE_NAME,
			dt.Columns.FILE_CONTENT,
		)+") AGAINST(? IN BOOLEAN MODE)", phrase).
		Where(pt.Columns.TEAM_ID+"=?", teamID).
		Where("("+member+" OR "+access+")", userID, userID)
}

// SearchDocuments 按全文匹配度返回团队内文档行；file_content 仅供服务层生成命中摘录。
func SearchDocuments(
	db *gorm.DB,
	userID string,
	teamID any,
	phrase string,
	limit, offset int64,
) []shared.Row {
	dt := dbschema.Documents
	dq := dt.Qualified()
	columns := dbschema.List(
		DocumentColumns,
		dt.Columns.FILE_CONTENT,
		"MATCH("+dbschema.List(
			dt.Columns.FILE_NAME,
			dt.Columns.FILE_CONTENT,
		)+") AGAINST(? IN BOOLEAN MODE) AS score",
	)
	return documentRows(db, searchQuery(db, userID, teamID, phrase).
		Select(columns, phrase).
		Order("score DESC,"+dq.Columns.UPDATED_AT+" DESC,"+dq.Columns.ID+" DESC").
		Limit(int(limit)).Offset(int(offset)))
}

// CountSearchDocuments 统计全文匹配的可见文档数量。
func CountSearchDocuments(db *gorm.DB, userID string, teamID any, phrase string) int64 {
	row := One(searchQuery(db, userID, teamID, phrase).Select("COUNT(*) AS total"))
	if row == nil {
		return 0
	}
	return shared.Int64(row["total"])
}

func WorkspaceProjectMembers(db *gorm.DB, projectID any) []shared.Row {
	pmt := dbschema.ProjectMembers
	return Rows(
		db.Table(pmt.Name).
			Select(pmt.Columns.USER_ID).
			Where(pmt.Columns.PROJECT_ID+"=?", projectID).
			Order(pmt.Columns.USER_ID),
	)
}

func WorkspaceTeamMembers(db *gorm.DB, teamID any) []shared.Row {
	mt := dbschema.TeamMembers
	return Rows(db.Table(mt.Name).Select(mt.Columns.USER_ID).Where(mt.Columns.TEAM_ID+"=?", teamID))
}

func WorkspaceSetProjectPrivileges(db *gorm.DB, projectID any, encoded string, members []string) {
	pt := dbschema.Projects
	pmt := dbschema.ProjectMembers
	Must(
		db.Table(pt.Name).
			Where(pt.Columns.ID+"=?", projectID).
			Update(pt.Columns.PRIVILEGES, encoded),
	)
	Must(db.Table(pmt.Name).Where(pmt.Columns.PROJECT_ID+"=?", projectID).Delete(&map[string]any{}))
	for _, id := range members {
		Must(
			db.Table(pmt.Name).
				Create(map[string]any{pmt.Columns.PROJECT_ID: projectID, pmt.Columns.USER_ID: id}),
		)
	}
}

func WorkspaceInsertDocument(db *gorm.DB, key, fileName string, folderID any, creatorID string) {
	dt := dbschema.Documents
	Must(db.Table(dt.Name).Create(map[string]any{
		dt.Columns.FILE_KEY:   key,
		dt.Columns.FILE_NAME:  fileName,
		dt.Columns.FOLDER_ID:  folderID,
		dt.Columns.CREATOR_ID: creatorID,
		dt.Columns.UPDATED_BY: creatorID,
		dt.Columns.PRIVILEGES: `{"mode":"inherit"}`,
	}))
}

func documentUpdateActor(userID string) map[string]any {
	dt := dbschema.Documents
	var updatedBy any
	if userID != "" {
		updatedBy = userID
	}
	return map[string]any{
		dt.Columns.UPDATED_BY: updatedBy, dt.Columns.UPDATED_BY_ANONYMOUS: userID == "",
		dt.Columns.UPDATED_AT: gorm.Expr("CURRENT_TIMESTAMP()"),
	}
}

func WorkspaceUpdateDocument(
	db *gorm.DB,
	key string,
	changes shared.Row,
	incrementRevision bool,
	userID string,
) {
	dt := dbschema.Documents
	values := map[string]any{}
	for key, value := range changes {
		values[key] = value
	}
	if incrementRevision {
		values[dt.Columns.REVISION] = gorm.Expr(dt.Columns.REVISION + " + 1")
	}
	for field, value := range documentUpdateActor(userID) {
		values[field] = value
	}
	Must(
		db.Table(dt.Name).Where(&model.Document{FileKey: key}, dt.Columns.FILE_KEY).Updates(values),
	)
}

func WorkspaceDeleteDocument(db *gorm.DB, id any, key string) {
	dt := dbschema.Documents
	fileTable := dbschema.Files
	Must(
		db.Table(fileTable.Name).
			Where(&model.File{FileKey: key}, fileTable.Columns.FILE_KEY).
			Delete(&map[string]any{}),
	)
	// Foreign keys cascade to file_shares and recent_files; shared blobs stay in local storage.
	// 外键级联处理 file_shares 和 recent_files；共享二进制对象仍保留在本地存储中。
	Must(db.Table(dt.Name).Where(dt.Columns.ID+"=?", id).Delete(&map[string]any{}))
}

// WorkspaceTrashDocument 将文档移入回收站。
func WorkspaceTrashDocument(db *gorm.DB, documentID any, userID string) {
	dt := dbschema.Documents
	Must(db.Table(dt.Name).
		Where(dt.Columns.ID+" = ? AND "+dt.Columns.DELETED_AT+" IS NULL", documentID).
		Updates(map[string]any{
			dt.Columns.DELETED_AT: gorm.Expr("CURRENT_TIMESTAMP(6)"),
			dt.Columns.DELETED_BY: userID,
			dt.Columns.EXPIRES_AT: gorm.Expr("DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL 30 DAY)"),
			dt.Columns.UPDATED_AT: gorm.Expr(dt.Columns.UPDATED_AT),
		}))
}

// WorkspaceTrashFolder 将文件夹移入回收站。
func WorkspaceTrashFolder(db *gorm.DB, folderID any, userID string) {
	ft := dbschema.Folders
	Must(db.Table(ft.Name).
		Where(ft.Columns.ID+" = ? AND "+ft.Columns.DELETED_AT+" IS NULL", folderID).
		Updates(map[string]any{
			ft.Columns.DELETED_AT: gorm.Expr("CURRENT_TIMESTAMP(6)"),
			ft.Columns.DELETED_BY: userID,
			ft.Columns.EXPIRES_AT: gorm.Expr("DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL 30 DAY)"),
			ft.Columns.UPDATED_AT: gorm.Expr(ft.Columns.UPDATED_AT),
		}))
}
