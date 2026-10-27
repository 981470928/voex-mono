package service

import (
	"context"
	"encoding/json"
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
		shared.Fail(400, "userConfig 必须是非空 JSON 对象")
	}
	return s.tx(ctx, false, func(tx *gorm.DB) any {
		// Lock the current user's row before reading so concurrent patches do
		// not overwrite keys added by another request. No workspace lock is needed.
		config := decodeUserConfig(repository.AuthUserConfigForUpdate(tx, userID))
		// Match Object.assign: replace supplied top-level values, including null,
		// arrays and whole nested objects, without interpreting their contents.
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
		shared.Fail(401, "登录已失效，请重新登录")
	}
	decoder := json.NewDecoder(strings.NewReader(shared.String(row["user_config"])))
	// Preserve JSON numbers when an unrelated field is updated.
	decoder.UseNumber()
	var config shared.Row
	shared.Must(decoder.Decode(&config))
	if config == nil {
		panic("stored user config is not an object")
	}
	return config
}
