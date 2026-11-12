package service

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"

	"gorm.io/gorm"
)

// The API key is encrypted with a domain-separated key, never returned to clients.
// API key 使用经过域分离的密钥加密，绝不返回给客户端。
func (s *Service) aiCipher() cipher.AEAD {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte("voex/ai-model-keys/v1"))
	block, err := aes.NewCipher(mac.Sum(nil))
	shared.Must(err)
	aead, err := cipher.NewGCM(block)
	shared.Must(err)
	return aead
}

func aiModelDTO(row shared.Row) shared.Row {
	result := shared.Row{}
	for _, key := range []string{
		"id",
		"name",
		"protocol",
		"base_url",
		"model",
		"temperature",
		"max_tokens",
		"token_parameter",
	} {
		result[key] = row[key]
	}
	result["has_key"] = shared.String(row["key_cipher"]) != ""
	result["multimodal_enabled"] = shared.Bool(row["multimodal_enabled"])
	return result
}

func (s *Service) ListAIModels(ctx context.Context) []shared.Row {
	return s.tx(ctx, false, func(db *gorm.DB) any {
		rows := repository.AIModels(db, shared.String(identity.User(ctx)["id"]))
		result := make([]shared.Row, 0, len(rows))
		for _, row := range rows {
			result = append(result, aiModelDTO(row))
		}
		return result
	}).([]shared.Row)
}

func aiEndpoint(raw, protocol string) string {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil ||
		u.RawQuery != "" ||
		u.Fragment != "" ||
		len(raw) > 2048 {
		shared.Fail(http.StatusBadRequest, shared.MsgAIEndpointInvalid)
	}
	suffix := "/chat/completions"
	if protocol == "anthropic" {
		suffix = "/messages"
	}
	if !strings.HasSuffix(u.Path, suffix) {
		if u.Path == "" {
			u.Path = "/v1"
		}
		u.Path = strings.TrimRight(u.Path, "/") + suffix
	}
	return u.String()
}

func (s *Service) SaveAIModel(ctx context.Context, id string, body shared.Row) shared.Row {
	return s.tx(ctx, true, func(db *gorm.DB) any {
		user := shared.String(identity.User(ctx)["id"])
		old := repository.AIModel(db, user, id)
		protocol := shared.String(body["protocol"])
		if protocol != "openai" && protocol != "anthropic" {
			shared.Fail(http.StatusBadRequest, shared.MsgAIProtocolInvalid)
		}
		multimodal := false
		if value, exists := body["multimodal_enabled"]; exists {
			var valid bool
			multimodal, valid = value.(bool)
			if !valid {
				shared.Fail(
					http.StatusBadRequest,
					shared.MustBeMessage("多模态开关", shared.MsgBooleanType),
				)
			}
		}
		base := shared.String(body["base_url"])
		endpoint := aiEndpoint(base, protocol)
		name := shared.Name(body["name"], "模型配置名称")
		if len([]rune(name)) > 128 {
			shared.Fail(http.StatusBadRequest, shared.MaxCharactersMessage("配置名称", 128))
		}
		model := shared.Name(body["model"], "模型 ID")
		tokenParameter := shared.String(body["token_parameter"])
		if tokenParameter == "" {
			tokenParameter = "max_completion_tokens"
		}
		if tokenParameter != "max_completion_tokens" && tokenParameter != "max_tokens" {
			shared.Fail(
				http.StatusBadRequest,
				shared.MustBeMessage(
					"输出参数名",
					shared.MsgTokenParameterOptions,
				),
			)
		}
		tokens, valid := workspaceRevision(body["max_tokens"])
		if !valid || tokens < 1 || tokens > 131072 {
			shared.Fail(http.StatusBadRequest, shared.IntegerRangeMessage("输出上限", 1, 131072))
		}
		var temperature any
		if body["temperature"] != nil {
			n, err := strconv.ParseFloat(fmt.Sprint(body["temperature"]), 64)
			max := 2.0
			if protocol == "anthropic" {
				max = 1
			}
			if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > max {
				shared.Fail(http.StatusBadRequest, shared.MsgAITemperatureInvalid)
			}
			temperature = n
		}
		key := shared.String(body["api_key"])
		keyCipher := shared.String(old["key_cipher"])
		if strings.TrimSpace(key) != "" {
			if len(key) > 4096 || strings.ContainsAny(key, "\r\n") {
				shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("API Key"))
			}
			aead := s.aiCipher()
			nonce := make([]byte, aead.NonceSize())
			_, err := rand.Read(nonce)
			shared.Must(err)
			keyCipher = base64.StdEncoding.EncodeToString(
				aead.Seal(
					nonce,
					nonce,
					[]byte(strings.TrimSpace(key)),
					[]byte(user+
						":"+
						id),
				),
			)
		} else if old == nil || old["base_url"] != endpoint || old["protocol"] != protocol {
			shared.Fail(http.StatusBadRequest, shared.MsgAIKeyRequired)
		}
		if old == nil && len(repository.AIModels(db, user)) >= 30 {
			shared.Fail(http.StatusBadRequest, shared.MsgAIModelLimit)
		}
		values := shared.Row{
			"name":               name,
			"protocol":           protocol,
			"base_url":           endpoint,
			"model":              model,
			"key_cipher":         keyCipher,
			"temperature":        temperature,
			"max_tokens":         int(tokens),
			"token_parameter":    tokenParameter,
			"multimodal_enabled": multimodal,
		}
		repository.SaveAIModel(db, user, id, values, old != nil)
		return aiModelDTO(repository.AIModel(db, user, id))
	}).(shared.Row)
}

func (s *Service) DeleteAIModel(ctx context.Context, id string) {
	s.tx(ctx, true, func(db *gorm.DB) any {
		repository.DeleteAIModel(db, shared.String(identity.User(ctx)["id"]), id)
		return nil
	})
}

var aiNonPublicRanges = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("::/96"), netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"), netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001::/23"), netip.MustParsePrefix("2002::/16"),
}

// Resolve and pin a public address at dial time; redirects and environment proxies are disabled.
// This prevents custom endpoints from reaching loopback, LAN and cloud metadata services.
// 建立连接时解析并固定公网地址；禁用重定向和环境变量代理。
// 这样可防止自定义端点访问回环地址、局域网和云元数据服务。
func aiDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	for _, ip := range ips {
		ip = ip.Unmap()
		if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
			return nil, fmt.Errorf("non-public endpoint")
		}
		for _, prefix := range aiNonPublicRanges {
			if prefix.Contains(ip) {
				return nil, fmt.Errorf("non-public endpoint")
			}
		}
	}
	var last error
	for _, ip := range ips {
		conn, err := (&net.Dialer{Timeout: 15 * time.Second}).DialContext(
			ctx,
			network,
			net.JoinHostPort(ip.String(), port),
		)
		if err == nil {
			return conn, nil
		}
		last = err
	}
	if last == nil {
		last = fmt.Errorf("no endpoint addresses")
	}
	return nil, last
}

var aiHTTP = &http.Client{
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	Transport: &http.Transport{
		DialContext:         aiDial,
		TLSHandshakeTimeout: 15 * time.Second,
		IdleConnTimeout:     60 * time.Second,
		MaxIdleConnsPerHost: 2,
	},
}
var aiActive sync.Map

func (s *Service) AIChat(ctx context.Context, id string, body shared.Row) json.RawMessage {
	user := shared.String(identity.User(ctx)["id"])
	if _, loaded := aiActive.LoadOrStore(user, true); loaded {
		shared.Fail(http.StatusTooManyRequests, shared.MsgAIRequestActive)
	}
	defer aiActive.Delete(user)
	row := s.tx(ctx, false, func(db *gorm.DB) any {
		row := repository.AIModel(db, user, id)
		if row == nil {
			shared.Fail(http.StatusNotFound, shared.NotFoundMessage("模型配置"))
		}
		return row
	}).(shared.Row)
	aead := s.aiCipher()
	sealed, err := base64.StdEncoding.DecodeString(shared.String(row["key_cipher"]))
	if err != nil || len(sealed) < aead.NonceSize() {
		shared.Fail(http.StatusInternalServerError, shared.MsgAIKeyUnavailable)
	}
	key, err := aead.Open(
		nil,
		sealed[:aead.NonceSize()],
		sealed[aead.NonceSize():],
		[]byte(user+":"+id),
	)
	if err != nil {
		shared.Fail(http.StatusInternalServerError, shared.MsgAIKeyUnavailable)
	}
	messages, ok := body["messages"].([]any)
	if !ok || len(messages) == 0 || len(messages) > 160 {
		shared.Fail(http.StatusBadRequest, shared.MsgAIMessageCountInvalid)
	}
	messages = s.expandAIAttachmentMessages(ctx, row, messages)
	payload := shared.Row{"model": row["model"], "messages": messages, "stream": false}
	webEngine := ""
	if value, exists := body["web_search_engine"]; exists {
		var valid bool
		webEngine, valid = value.(string)
		if !valid {
			shared.Fail(http.StatusBadRequest, shared.MustBeMessage("联网搜索引擎", shared.MsgStringType))
		}
		if webEngine != "" {
			s.requireWebEngine(webEngine)
		}
	}
	if body["tools"] != nil {
		tools, ok := body["tools"].([]any)
		if !ok {
			shared.Fail(http.StatusBadRequest, shared.MustBeMessage("模型工具", shared.MsgArrayType))
		}
		enabledTools := make([]any, 0, len(tools))
		for _, tool := range tools {
			block, ok := aiMessageObject(tool)
			if !ok {
				shared.Fail(
					http.StatusBadRequest,
					shared.MustBeMessage("模型工具", shared.MsgObjectType),
				)
			}
			kind, _ := block["type"].(string)
			// Native provider search is no longer used, including legacy clients.
			// 不再使用服务提供方的原生搜索功能，旧版客户端也不例外。
			if kind == "web_search" || strings.HasPrefix(kind, "web_search_") {
				continue
			}
			name, _ := block["name"].(string)
			if function, ok := aiMessageObject(block["function"]); ok {
				name, _ = function["name"].(string)
			}
			if (name == "web_search" || name == "web_fetch") && webEngine == "" {
				continue
			}
			enabledTools = append(enabledTools, tool)
		}
		if len(enabledTools) > 0 {
			payload["tools"] = enabledTools
		}
	}
	if row["temperature"] != nil {
		payload["temperature"] = row["temperature"]
	}
	anthropic := row["protocol"] == "anthropic"
	if anthropic {
		payload["max_tokens"] = row["max_tokens"]
		if body["system"] != nil {
			payload["system"] = body["system"]
		}
	} else {
		parameter := shared.String(row["token_parameter"])
		if parameter != "max_tokens" {
			parameter = "max_completion_tokens"
		}
		payload[parameter] = row["max_tokens"]
	}
	data, err := json.Marshal(payload)
	shared.Must(err)
	if len(data) > aiProviderRequestSize {
		shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgAIRequestTooLarge)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		shared.String(row["base_url"]),
		bytes.NewReader(data),
	)
	shared.Must(err)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if anthropic {
		request.Header.Set("x-api-key", string(key))
		request.Header.Set("anthropic-version", "2023-06-01")
	} else {
		request.Header.Set("Authorization", "Bearer "+string(key))
	}
	response, err := aiHTTP.Do(request)
	if err != nil {
		shared.NetworkFailure("AI model request", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		shared.UpstreamFailure("AI model request", response.StatusCode)
	}
	result, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024+1))
	if err != nil {
		shared.NetworkFailure("read AI model response", err)
	}
	if len(result) > 2*1024*1024 || !json.Valid(result) {
		shared.NetworkFailure(
			"read AI model response",
			errors.New("invalid or oversized JSON response"),
		)
	}
	// Never echo an upstream response that contains the stored credential.
	// 绝不回传包含已存储凭据的上游响应。
	if len(key) > 0 && bytes.Contains(result, key) {
		shared.NetworkFailure(
			"read AI model response",
			errors.New("credential detected in response"),
		)
	}
	return json.RawMessage(result)
}
