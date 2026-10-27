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
	for _, key := range []string{"id", "name", "protocol", "base_url", "model", "temperature", "max_tokens", "token_parameter"} {
		result[key] = row[key]
	}
	result["has_key"] = shared.String(row["key_cipher"]) != ""
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
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(raw) > 2048 {
		shared.Fail(400, "API 地址需要是无账号、查询参数和片段的 HTTPS 地址")
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
			shared.Fail(400, "请选择 OpenAI Chat 或 Claude Messages 协议")
		}
		base := shared.String(body["base_url"])
		endpoint := aiEndpoint(base, protocol)
		name := shared.Name(body["name"], "模型配置名称")
		if len([]rune(name)) > 128 {
			shared.Fail(400, "配置名称最多 128 个字符")
		}
		model := shared.Name(body["model"], "模型 ID")
		tokenParameter := shared.String(body["token_parameter"])
		if tokenParameter == "" {
			tokenParameter = "max_completion_tokens"
		}
		if tokenParameter != "max_completion_tokens" && tokenParameter != "max_tokens" {
			shared.Fail(400, "输出参数名只能是 max_completion_tokens 或 max_tokens")
		}
		tokens, valid := workspaceRevision(body["max_tokens"])
		if !valid || tokens < 1 || tokens > 131072 {
			shared.Fail(400, "输出上限需为 1–131072 的整数")
		}
		var temperature any
		if body["temperature"] != nil {
			n, err := strconv.ParseFloat(fmt.Sprint(body["temperature"]), 64)
			max := 2.0
			if protocol == "anthropic" {
				max = 1
			}
			if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > max {
				shared.Fail(400, "Temperature 超出该协议允许的范围")
			}
			temperature = n
		}
		key := shared.String(body["api_key"])
		keyCipher := shared.String(old["key_cipher"])
		if strings.TrimSpace(key) != "" {
			if len(key) > 4096 || strings.ContainsAny(key, "\r\n") {
				shared.Fail(400, "API Key 格式不正确")
			}
			aead := s.aiCipher()
			nonce := make([]byte, aead.NonceSize())
			_, err := rand.Read(nonce)
			shared.Must(err)
			keyCipher = base64.StdEncoding.EncodeToString(aead.Seal(nonce, nonce, []byte(strings.TrimSpace(key)), []byte(user+":"+id)))
		} else if old == nil || old["base_url"] != endpoint || old["protocol"] != protocol {
			shared.Fail(400, "新增配置或更换 API 地址、协议时需要重新填写 API Key")
		}
		if old == nil && len(repository.AIModels(db, user)) >= 30 {
			shared.Fail(400, "最多保存 30 个模型配置")
		}
		values := shared.Row{"name": name, "protocol": protocol, "base_url": endpoint, "model": model, "key_cipher": keyCipher, "temperature": temperature, "max_tokens": int(tokens), "token_parameter": tokenParameter}
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
		conn, err := (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
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
	Transport:     &http.Transport{DialContext: aiDial, TLSHandshakeTimeout: 15 * time.Second, IdleConnTimeout: 60 * time.Second, MaxIdleConnsPerHost: 2},
}
var aiActive sync.Map

func (s *Service) AIChat(ctx context.Context, id string, body shared.Row) json.RawMessage {
	user := shared.String(identity.User(ctx)["id"])
	if _, loaded := aiActive.LoadOrStore(user, true); loaded {
		shared.Fail(429, "已有 AI 请求正在进行，请等待完成")
	}
	defer aiActive.Delete(user)
	row := s.tx(ctx, false, func(db *gorm.DB) any {
		row := repository.AIModel(db, user, id)
		if row == nil {
			shared.Fail(404, "模型配置不存在")
		}
		return row
	}).(shared.Row)
	aead := s.aiCipher()
	sealed, err := base64.StdEncoding.DecodeString(shared.String(row["key_cipher"]))
	if err != nil || len(sealed) < aead.NonceSize() {
		shared.Fail(500, "模型密钥不可用，请重新保存 API Key")
	}
	key, err := aead.Open(nil, sealed[:aead.NonceSize()], sealed[aead.NonceSize():], []byte(user+":"+id))
	if err != nil {
		shared.Fail(500, "模型密钥不可用，请重新保存 API Key")
	}
	messages, ok := body["messages"].([]any)
	if !ok || len(messages) == 0 || len(messages) > 160 {
		shared.Fail(400, "对话消息数量需为 1–160 条")
	}
	payload := shared.Row{"model": row["model"], "messages": messages, "stream": false}
	if body["tools"] != nil {
		payload["tools"] = body["tools"]
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
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, shared.String(row["base_url"]), bytes.NewReader(data))
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
		shared.Fail(502, "无法连接模型服务，请检查公网 HTTPS 地址或稍后重试")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		shared.Fail(502, fmt.Sprintf("模型服务返回 HTTP %d，请检查模型 ID、API Key、余额和参数", response.StatusCode))
	}
	result, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024+1))
	if err != nil || len(result) > 2*1024*1024 || !json.Valid(result) {
		shared.Fail(502, "模型返回了无效或过大的响应")
	}
	// Never echo an upstream response that contains the stored credential.
	if len(key) > 0 && bytes.Contains(result, key) {
		shared.Fail(502, "模型服务返回了不安全的响应")
	}
	return json.RawMessage(result)
}
