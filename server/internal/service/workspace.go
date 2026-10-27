package service

import (
	"context"
	"encoding/json"
	"math"
	"unicode/utf16"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

func (s *Service) ProjectPermissions(db *gorm.DB, ctx context.Context, key string) shared.Row {
	userID := shared.String(identity.User(ctx)["id"])
	row := repository.WorkspaceProjectPermission(db, userID, key)
	manager := row != nil && shared.String(row["user_id"]) != "" && (shared.String(row["owner_id"]) == userID || shared.String(row["role"]) == "admin")
	member := row != nil && shared.String(row["user_id"]) != ""
	edit := member && (manager || shared.Bool(row["explicit_member"]))
	owner := member && shared.String(row["owner_id"]) == userID
	return shared.Row{"read": member, "write": edit, "manage": manager, "share": edit, "remove": owner, "children_remove": edit}

}

func (s *Service) RequireProject(db *gorm.DB, ctx context.Context, key, action string) shared.Row {
	permissions := s.ProjectPermissions(db, ctx, key)
	if !shared.Bool(permissions[action]) {
		shared.Fail(404, "项目不存在或没有访问权限")
	}
	return permissions
}

func workspaceFindProject(db *gorm.DB, key string) shared.Row {
	row := repository.WorkspaceProjectByKey(db, key)
	if row == nil {
		shared.Fail(404, "项目不存在")
	}
	return row
}

func workspaceFindFolder(db *gorm.DB, key string) shared.Row {
	row := repository.WorkspaceFolderByKey(db, key)
	if row == nil {
		shared.Fail(404, "文件夹不存在")
	}
	return row
}

func workspaceFolderProject(db *gorm.DB, folder shared.Row) shared.Row {
	row := repository.WorkspaceProjectByID(db, folder["project_id"])
	if row == nil {
		shared.Fail(404, "项目不存在")
	}
	return row
}

func workspaceInsertProject(db *gorm.DB, name, creatorID string, teamID any) shared.Row {
	return repository.WorkspaceInsertProject(db, shared.PublicKey(), name, creatorID, teamID)
}

func workspaceInsertFolder(db *gorm.DB, projectID any, name string) shared.Row {
	return repository.WorkspaceInsertFolder(db, shared.PublicKey(), projectID, name)
}

func workspaceEnsureRoot(db *gorm.DB, projectID any) shared.Row {
	if row := repository.WorkspaceFirstRoot(db, projectID); row != nil {
		return row
	}
	return workspaceInsertFolder(db, projectID, "默认文件夹")
}

func projectDTO(row, permissions shared.Row) shared.Row {
	return shared.Row{
		"project_key": row["project_key"], "team_key": row["team_key"], "privileges": shared.Policy(row["privileges"]),
		"name": row["name"], "created_at": shared.Timestamp(row["created_at"]), "updated_at": shared.Timestamp(row["updated_at"]), "permissions": permissions,
	}
}

func folderDTO(row shared.Row, projectKey string) shared.Row {
	return shared.Row{
		"folder_key": row["folder_key"], "privileges": shared.Row{"mode": "inherit"}, "project_key": projectKey,
		"parent_key": nil, "name": row["name"], "created_at": shared.Timestamp(row["created_at"]), "updated_at": shared.Timestamp(row["updated_at"]),
	}
}

func DocumentDTO(row shared.Row) shared.Row {
	return shared.Row{
		"revision": shared.Int64(row["revision"]), "privileges": shared.Row{"mode": "inherit"},
		"creator": shared.Row{"id": row["creator_id"], "name": row["creator_name"], "avator": row["creator_avator"]},
		"id":      row["id"], "file_key": row["file_key"], "file_name": row["file_name"],
		"project_key": row["project_key"], "folder_key": row["folder_key"],
		"created_at": shared.Timestamp(row["created_at"]), "updated_at": shared.Timestamp(row["updated_at"]),
	}
}

func (s *Service) workspaceListProjects(db *gorm.DB, ctx context.Context, teamKey string) []shared.Row {
	team := s.SelectedTeam(db, ctx, teamKey)
	rows := repository.WorkspaceProjects(db, team["id"])
	result := make([]shared.Row, 0, len(rows))
	for _, row := range rows {
		permissions := s.ProjectPermissions(db, ctx, shared.String(row["project_key"]))
		if shared.Bool(permissions["read"]) {
			result = append(result, projectDTO(row, permissions))
		}
	}
	return result
}

func (s *Service) ListProjects(ctx context.Context, teamKey string) []shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any { return s.workspaceListProjects(db, ctx, teamKey) }).([]shared.Row)
}

func (s *Service) InitializeWorkspace(ctx context.Context, teamKey string) []shared.Row {
	return s.tx(ctx, true, func(db *gorm.DB) any { return s.workspaceListProjects(db, ctx, teamKey) }).([]shared.Row)
}

func (s *Service) CreateProject(ctx context.Context, name, teamKey string) shared.Row {
	return s.tx(ctx, true, func(db *gorm.DB) any {
		team := s.SelectedTeam(db, ctx, teamKey)
		s.teamRow(db, ctx, shared.String(team["team_key"]), true)
		project := workspaceInsertProject(db, name, shared.String(identity.User(ctx)["id"]), team["id"])
		workspaceEnsureRoot(db, project["id"])
		return projectDTO(project, s.RequireProject(db, ctx, shared.String(project["project_key"]), "write"))
	}).(shared.Row)
}

func (s *Service) RenameProject(ctx context.Context, key, name string) {
	s.tx(ctx, true, func(db *gorm.DB) any {
		project := workspaceFindProject(db, key)
		s.RequireProject(db, ctx, key, "write")
		repository.WorkspaceRenameProject(db, project["id"], name)
		return nil
	})
}

func (s *Service) DeleteProject(ctx context.Context, key string, cascade bool) {
	s.txEvent(ctx, "deleted", "", func(db *gorm.DB) any {
		project := workspaceFindProject(db, key)
		s.RequireProject(db, ctx, key, "remove")
		if !cascade && repository.WorkspaceProjectHasFolders(db, project["id"]) {
			shared.Fail(409, "项目中有子项，请确认连同所有子项一起删除")
		}
		repository.WorkspaceDeleteProject(db, project["id"])
		return nil
	})
}

func (s *Service) ProjectTree(ctx context.Context, key string) shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		project := workspaceFindProject(db, key)
		permissions := s.ProjectPermissions(db, ctx, key)
		folders := repository.WorkspaceFolders(db, project["id"])
		documents := repository.WorkspaceProjectDocuments(db, project["id"])
		folderList, documentList := make([]shared.Row, 0, len(folders)), make([]shared.Row, 0, len(documents))
		visibleFolders := map[string]bool{}
		for _, document := range documents {
			access := s.documentPermissions(db, ctx, document, permissions)
			if !shared.Bool(access["read"]) {
				continue
			}
			item := DocumentDTO(document)
			item["permissions"] = access
			documentList = append(documentList, item)
			visibleFolders[shared.String(document["folder_key"])] = true
		}
		if !shared.Bool(permissions["read"]) && len(documentList) == 0 {
			shared.Fail(404, "项目不存在或没有访问权限")
		}
		for _, folder := range folders {
			if shared.Bool(permissions["read"]) || visibleFolders[shared.String(folder["folder_key"])] {
				folderList = append(folderList, folderDTO(folder, key))
			}
		}
		return shared.Row{"project": projectDTO(project, permissions), "folders": folderList, "documents": documentList}
	}).(shared.Row)
}

func (s *Service) CreateFolder(ctx context.Context, projectKey, parentKey, name string) shared.Row {
	return s.tx(ctx, true, func(db *gorm.DB) any {
		project := workspaceFindProject(db, projectKey)
		s.RequireProject(db, ctx, projectKey, "write")
		if parentKey != "" {
			shared.Fail(400, "项目仅允许一层文件夹，文件夹下只能创建文件")
		}
		return folderDTO(workspaceInsertFolder(db, project["id"], name), projectKey)
	}).(shared.Row)
}

func (s *Service) RenameFolder(ctx context.Context, key, name string) {
	s.tx(ctx, true, func(db *gorm.DB) any {
		folder := workspaceFindFolder(db, key)
		project := workspaceFolderProject(db, folder)
		s.RequireProject(db, ctx, shared.String(project["project_key"]), "write")
		repository.WorkspaceRenameFolder(db, folder["id"], name)
		return nil
	})
}

func (s *Service) DeleteFolder(ctx context.Context, key string, cascade bool) {
	s.txEvent(ctx, "deleted", "", func(db *gorm.DB) any {
		folder := workspaceFindFolder(db, key)
		project := workspaceFolderProject(db, folder)

		s.RequireProject(db, ctx, shared.String(project["project_key"]), "write")

		if !cascade && repository.WorkspaceFolderHasChildren(
			db, folder["project_id"], folder["id"],
		) {
			shared.Fail(409, "文件夹中有子项，请确认一并移入回收站")
		}

		userID := shared.String(identity.User(ctx)["id"])
		repository.WorkspaceTrashFolder(db, folder["id"], userID)
		return nil
	})
}

func (s *Service) ProjectPrivileges(ctx context.Context, key string) shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		project := workspaceFindProject(db, key)
		s.RequireProject(db, ctx, key, "manage")
		members := repository.WorkspaceProjectMembers(db, project["id"])
		ids := make([]string, 0, len(members))
		for _, member := range members {
			ids = append(ids, shared.String(member["user_id"]))
		}
		result := shared.Policy(project["privileges"])
		result["user_ids"] = ids
		return result
	}).(shared.Row)
}

func (s *Service) SetProjectPrivileges(ctx context.Context, key string, modeValue, idsValue any) shared.Row {
	return s.txEvent(ctx, "permissions", "", func(db *gorm.DB) any {
		project := workspaceFindProject(db, key)
		s.RequireProject(db, ctx, key, "manage")
		mode, isString := modeValue.(string)
		if !isString || mode != "restricted" {
			shared.Fail(400, "请使用指定项目编辑成员列表")
		}
		ids, valid := idsValue.([]any)
		if !valid || len(ids) > 1000 {
			shared.Fail(400, "项目成员列表不合法")
		}
		selected := make([]string, 0, len(ids))
		seen := map[string]bool{}
		for _, value := range ids {
			id, valid := value.(string)
			if !valid || len(utf16.Encode([]rune(id))) > 64 {
				shared.Fail(400, "项目成员列表不合法")
			}
			if !seen[id] {
				seen[id] = true
				selected = append(selected, id)
			}
		}
		if len(selected) != 0 {
			allowed := map[string]bool{}
			for _, member := range repository.WorkspaceTeamMembers(db, project["team_id"]) {
				allowed[shared.String(member["user_id"])] = true
			}
			for _, id := range selected {
				if !allowed[id] {
					shared.Fail(400, "只能授权给当前团队成员")
				}
			}
		}
		encoded, err := json.Marshal(shared.Row{"mode": mode})
		shared.Must(err)
		if mode != "restricted" {
			selected = []string{}
		}
		repository.WorkspaceSetProjectPrivileges(db, project["id"], string(encoded), selected)
		updated := workspaceFindProject(db, key)
		result := projectDTO(updated, s.RequireProject(db, ctx, key, "read"))
		result["privileges"] = shared.Row{"mode": mode, "user_ids": selected}
		return result
	}).(shared.Row)
}

func (s *Service) workspaceDocumentLocation(db *gorm.DB, ctx context.Context, projectKey, folderKey, teamKey string) (shared.Row, shared.Row) {
	var project, folder shared.Row
	if folderKey != "" {
		folder = workspaceFindFolder(db, folderKey)
		project = workspaceFolderProject(db, folder)
		if projectKey != "" && projectKey != shared.String(project["project_key"]) {
			shared.Fail(400, "文件夹不属于指定项目")
		}
		s.RequireProject(db, ctx, shared.String(project["project_key"]), "write")
	} else {
		if projectKey != "" {
			project = workspaceFindProject(db, projectKey)
		} else {
			team := s.SelectedTeam(db, ctx, teamKey)
			visible := []shared.Row{}
			for _, candidate := range s.workspaceListProjects(db, ctx, shared.String(team["team_key"])) {
				if shared.Bool(candidate["permissions"].(shared.Row)["write"]) {
					visible = append(visible, candidate)
				}
			}
			if len(visible) != 0 {
				project = workspaceFindProject(db, shared.String(visible[0]["project_key"]))
			} else {
				s.teamRow(db, ctx, shared.String(team["team_key"]), true)
				project = workspaceInsertProject(db, "默认项目", shared.String(identity.User(ctx)["id"]), team["id"])
			}
		}
		s.RequireProject(db, ctx, shared.String(project["project_key"]), "write")
		folder = workspaceEnsureRoot(db, project["id"])
	}
	if teamKey != "" && teamKey != shared.String(project["team_key"]) {
		shared.Fail(400, "项目不属于指定团队")
	}
	return project, folder
}

func (s *Service) FindDocument(db *gorm.DB, ctx context.Context, key, action string, content bool) shared.Row {
	row := repository.DocumentByKey(db, key, content)
	if row == nil {
		shared.Fail(404, "文档不存在")
	}
	permissions := s.DocumentPermissions(db, ctx, row)
	if !shared.Bool(permissions[action]) {
		shared.Fail(403, "没有此文件的操作权限")
	}
	row["permissions"] = permissions
	return row
}

type CreateDocumentInput struct {
	FileName   string
	ProjectKey string
	FolderKey  string
	TeamKey    string
}

func (s *Service) CreateDocument(ctx context.Context, input CreateDocumentInput) shared.Row {
	return s.tx(ctx, true, func(db *gorm.DB) any {
		project, folder := s.workspaceDocumentLocation(db, ctx, input.ProjectKey, input.FolderKey, input.TeamKey)
		key := shared.PublicKey()
		user := identity.User(ctx)
		repository.WorkspaceInsertDocument(db, key, input.FileName, folder["id"], shared.String(user["id"]))
		return shared.Row{
			"revision": 1, "privileges": shared.Row{"mode": "inherit"}, "creator": shared.Creator(user),
			"file_key": key, "file_name": input.FileName, "project_key": project["project_key"], "folder_key": folder["folder_key"],
			"project_name": project["name"], "folder_path": []any{folder["name"]},
		}
	}).(shared.Row)
}

func (s *Service) GetDocument(ctx context.Context, key string, recordVisit bool) shared.Row {
	return s.tx(ctx, recordVisit, func(db *gorm.DB) any {
		row := s.FindDocument(db, ctx, key, "read", true)
		result := s.addCollaborationMetadata(db, key, DocumentDTO(row))
		result["file_content"] = row["file_content"]
		result["permissions"] = row["permissions"]
		if recordVisit {
			repository.RecordRecentFile(db, shared.String(identity.User(ctx)["id"]), row)
		}
		return result
	}).(shared.Row)
}

// workspaceRevision follows JavaScript Number.isInteger, including large finite integers.
func workspaceRevision(value any) (float64, bool) {
	var number float64
	switch v := value.(type) {
	case json.Number:
		parsed, err := v.Float64()
		if err != nil {
			return 0, false
		}
		number = parsed
	case float64:
		number = v
	default:
		return 0, false
	}
	if math.IsNaN(number) || math.IsInf(number, 0) || number != math.Trunc(number) {
		return 0, false
	}
	return number, true
}

// UpdateDocument 只更新名称；正文持久化由协同服务和 AI 审阅事务负责。
func (s *Service) UpdateDocument(ctx context.Context, key, name string) int64 {
	return s.txEvent(ctx, "metadata", key, func(db *gorm.DB) any {
		document := s.FindDocument(db, ctx, key, "write", false)
		repository.WorkspaceUpdateDocument(db, shared.String(document["file_key"]), shared.Row{"file_name": name}, false, shared.String(identity.User(ctx)["id"]))
		return shared.Int64(document["revision"])
	}).(int64)
}

func (s *Service) DeleteDocument(ctx context.Context, key string) {
	s.txEvent(ctx, "deleted", key, func(db *gorm.DB) any {
		document := s.FindDocument(db, ctx, key, "remove", false)
		userID := shared.String(identity.User(ctx)["id"])

		repository.WorkspaceTrashDocument(db, document["id"], userID)
		return nil
	})
}

func (s *Service) ListDocuments(ctx context.Context, code string) []shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		documents := repository.WorkspaceDocuments(db, shared.String(identity.User(ctx)["id"]), code)
		readable := map[string]bool{}
		visible := make([]shared.Row, 0, len(documents))
		for _, document := range documents {
			projectKey := shared.String(document["project_key"])
			allowed, cached := readable[projectKey]
			if !cached {
				allowed = shared.Bool(s.ProjectPermissions(db, ctx, projectKey)["read"])
				readable[projectKey] = allowed
			}
			if allowed {
				visible = append(visible, DocumentDTO(document))
			}
		}
		return visible
	}).([]shared.Row)
}
