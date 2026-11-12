package config

import (
	"encoding/json"
	"strings"
)

// Search credentials are server-only. An empty key hides the corresponding provider.
// 搜索凭据仅供服务器使用；密钥为空时隐藏对应服务提供方。
func ReadWebSearchKeys() map[string]string {
	raw := Env("VOEX_WEB_SEARCH_KEYS", "{}")
	keys := map[string]string{}
	if json.Unmarshal([]byte(raw), &keys) != nil || keys == nil {
		panic("VOEX_WEB_SEARCH_KEYS must be a JSON object")
	}
	for name, key := range keys {
		if (name != "tavily" && name != "querit") || len(key) > 4096 ||
			strings.ContainsAny(key, "\r\n\x00") {
			panic("invalid web search configuration")
		}
		for _, char := range key {
			if char < 32 || char == 127 {
				panic("invalid web search credential")
			}
		}
		keys[name] = strings.TrimSpace(key)
	}
	return keys
}
