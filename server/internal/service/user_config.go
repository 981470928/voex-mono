package service

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

func (s *Service) UserConfig(ctx context.Context) shared.Row {
	userID := shared.String(identity.User(ctx)["id"])
	config := decodeUserConfig(repository.AuthUserConfig(s.db.WithContext(ctx), userID))
	return shared.Row{"userConfig": config}
}

func (s *Service) UpdateUserConfig(ctx context.Context, input shared.Row) shared.Row {
	userID := shared.String(identity.User(ctx)["id"])
	patch, ok := input["userConfig"].(map[string]any)
	if !ok || len(patch) == 0 {
		shared.Fail(
			http.StatusBadRequest,
			shared.MustBeMessage("userConfig", shared.MsgNonEmptyJSONObjectType),
		)
	}
	return s.tx(ctx, false, func(tx *gorm.DB) any {
		// Lock the current user's row before reading so concurrent patches do
		// not overwrite keys added by another request. No workspace lock is needed.
		// 读取前先锁定当前用户记录，防止并发补丁覆盖另一请求新增的 key。
		// 无需获取工作区锁。
		config := decodeUserConfig(repository.AuthUserConfigForUpdate(tx, userID))
		// Match Object.assign: replace supplied top-level values, including null,
		// arrays and whole nested objects, without interpreting their contents.
		// 遵循 Object.assign 语义：替换传入的顶层值，包括 null、数组和完整嵌套对象，
		// 不解析其内部内容。
		for key, value := range patch {
			config[key] = value
		}
		encoded, err := json.Marshal(config)
		shared.Must(err)
		repository.AuthUpdateUserConfig(tx, userID, string(encoded))
		return shared.Row{"userConfig": config}
	}).(shared.Row)
}

func decodeUserConfig(row shared.Row) shared.Row {
	if row == nil {
		shared.Fail(http.StatusUnauthorized, shared.MsgSessionInvalid)
	}
	decoder := json.NewDecoder(strings.NewReader(shared.String(row["user_config"])))
	// Preserve JSON numbers when an unrelated field is updated.
	// 更新无关字段时，保留 JSON 数字类型。
	decoder.UseNumber()
	var config shared.Row
	shared.Must(decoder.Decode(&config))
	if config == nil {
		panic("stored user config is not an object")
	}
	return config
}
