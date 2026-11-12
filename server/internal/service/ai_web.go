package service

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
	"voex-server/internal/identity"
	"voex-server/internal/shared"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

const aiWebMaxBytes = 2 * 1024 * 1024
const aiWebMaxText = 20000

var aiWebActive sync.Map
var aiWebTransport = &http.Transport{
	DialContext: aiDial, TLSHandshakeTimeout: 10 * time.Second,
	ResponseHeaderTimeout: 15 * time.Second, IdleConnTimeout: 60 * time.Second,
	MaxIdleConns: 20, MaxIdleConnsPerHost: 2, MaxConnsPerHost: 8,
	MaxResponseHeaderBytes: 64 * 1024,
}
var aiSearchHTTP = &http.Client{
	Timeout: 25 * time.Second, Transport: aiWebTransport,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}
var aiFetchHTTP = &http.Client{
	Timeout: 25 * time.Second, Transport: aiWebTransport,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 4 {
			return fmt.Errorf("too many redirects")
		}
		_, err := aiWebURL(req.URL.String())
		return err
	},
}

func (s *Service) ConfigureWebSearch(keys map[string]string) {
	s.webSearchKeys = make(map[string]string, len(keys))
	for name, key := range keys {
		s.webSearchKeys[name] = key
	}
}

func (s *Service) AIWebEngines() []shared.Row {
	engines := make([]shared.Row, 0, 3)
	if s.webSearchKeys["tavily"] != "" {
		engines = append(engines, shared.Row{"id": "tavily", "name": "Tavily"})
	}
	if s.webSearchKeys["querit"] != "" {
		engines = append(engines, shared.Row{"id": "querit", "name": "Querit"})
	}
	// Public RSS search is always offered; it does not need a credential.
	// 始终提供公共 RSS 搜索，无需凭据。
	return append(engines, shared.Row{"id": "bing", "name": "Bing RSS"})
}

func (s *Service) requireWebEngine(engine string) {
	if engine == "bing" ||
		(engine == "tavily" || engine == "querit") && s.webSearchKeys[engine] != "" {
		return
	}
	shared.Fail(http.StatusBadRequest, shared.MsgWebEngineUnavailable)
}

func (s *Service) beginAIWeb(ctx context.Context, body shared.Row) (string, func()) {
	user := shared.String(identity.User(ctx)["id"])
	engine, ok := body["engine"].(string)
	if !ok {
		shared.Fail(http.StatusBadRequest, shared.MsgWebEngineRequired)
	}
	s.requireWebEngine(engine)
	if _, loaded := aiWebActive.LoadOrStore(user, true); loaded {
		shared.Fail(http.StatusTooManyRequests, shared.MsgWebRequestActive)
	}
	return engine, func() { aiWebActive.Delete(user) }
}

// The same checks run on every redirect. aiDial resolves and pins public IPs on
// connection, including IPv4-mapped IPv6, so DNS cannot redirect us into a LAN.
// 每次重定向都执行相同检查；aiDial 在建立连接时解析并固定公网 IP，
// 包括 IPv4 映射的 IPv6 地址，防止 DNS 将请求导向局域网。
func aiWebURL(raw string) (*url.URL, error) {
	if len(raw) > 4096 || strings.TrimSpace(raw) != raw {
		return nil, fmt.Errorf("invalid URL")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" ||
		u.User != nil ||
		u.Opaque != "" {
		return nil, fmt.Errorf("invalid URL")
	}
	if port := u.Port(); port != "" &&
		!(u.Scheme == "https" && port == "443" || u.Scheme == "http" && port == "80") {
		return nil, fmt.Errorf("unsupported port")
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") ||
		strings.HasSuffix(host, ".local") ||
		strings.Contains(host, "%") {
		return nil, fmt.Errorf("non-public URL")
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		ip = ip.Unmap()
		if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
			return nil, fmt.Errorf("non-public URL")
		}
		for _, prefix := range aiNonPublicRanges {
			if prefix.Contains(ip) {
				return nil, fmt.Errorf("non-public URL")
			}
		}
	}
	u.Fragment = ""
	return u, nil
}

func aiWebClip(text string, maximum int) (string, bool) {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) > maximum {
		return string(runes[:maximum]), true
	}
	return string(runes), false
}

func aiWebRead(response *http.Response, label string) []byte {
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		shared.UpstreamFailure(label, response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, aiWebMaxBytes+1))
	if err != nil {
		shared.NetworkFailure(label+" response read", err)
	}
	if len(data) > aiWebMaxBytes {
		shared.NetworkFailure(label, errors.New("response exceeds 2 MiB"))
	}
	return data
}

type aiWebResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Content string `json:"content"`
}

func aiNormalizeResults(results []aiWebResult, limit int) []aiWebResult {
	out := make([]aiWebResult, 0, limit)
	seen := map[string]bool{}
	for _, item := range results {
		u, err := aiWebURL(item.URL)
		if err != nil || seen[u.String()] {
			continue
		}
		item.URL = u.String()
		seen[item.URL] = true
		item.Title, _ = aiWebClip(strings.Join(strings.Fields(item.Title), " "), 300)
		item.Content, _ = aiWebClip(item.Content, 2000)
		if item.Title == "" {
			item.Title = u.Hostname()
		}
		out = append(out, item)
		if len(out) == limit {
			break
		}
	}
	return out
}

func (s *Service) AIWebSearch(ctx context.Context, body shared.Row) shared.Row {
	engine, done := s.beginAIWeb(ctx, body)
	defer done()
	query, ok := body["query"].(string)
	query = strings.TrimSpace(query)
	if !ok || query == "" || utf8.RuneCountInString(query) > 500 {
		shared.Fail(http.StatusBadRequest, shared.CharacterRangeMessage("搜索词", 1, 500))
	}
	limit := 5
	if value, exists := body["max_results"]; exists {
		n, valid := workspaceRevision(value)
		if !valid || n < 1 || n > 8 {
			shared.Fail(http.StatusBadRequest, shared.IntegerRangeMessage("搜索结果数量", 1, 8))
		}
		limit = int(n)
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	var results []aiWebResult
	switch engine {
	case "tavily":
		results = s.aiTavilySearch(ctx, query, limit)
	case "querit":
		results = s.aiQueritSearch(ctx, query, limit)
	case "bing":
		results = aiBingSearch(ctx, query, limit)
	}
	return shared.Row{
		"engine":  engine,
		"query":   query,
		"results": aiNormalizeResults(results, limit),
	}
}

func (s *Service) aiTavilySearch(ctx context.Context, query string, limit int) []aiWebResult {
	payload, err := json.Marshal(shared.Row{
		"query": query, "max_results": limit, "search_depth": "basic",
		"include_answer": false, "include_raw_content": false, "auto_parameters": false,
	})
	shared.Must(err)
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"https://api.tavily.com/search",
		bytes.NewReader(payload),
	)
	shared.Must(err)
	key := s.webSearchKeys["tavily"]
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := aiSearchHTTP.Do(request)
	if err != nil {
		shared.NetworkFailure("Tavily 搜索", err)
	}
	defer response.Body.Close()
	data := aiWebRead(response, "Tavily 搜索")
	if key != "" && bytes.Contains(data, []byte(key)) {
		shared.NetworkFailure("Tavily response", errors.New("credential detected in response"))
	}
	var envelope struct {
		Results *[]aiWebResult `json:"results"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		shared.NetworkFailure("decode Tavily response", err)
	}
	if envelope.Results == nil {
		shared.NetworkFailure("decode Tavily response", errors.New("missing results"))
	}
	return *envelope.Results
}

func aiBingSearch(ctx context.Context, query string, limit int) []aiWebResult {
	values := url.Values{"q": {query}, "format": {"rss"}, "count": {fmt.Sprint(limit)}}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"https://www.bing.com/search?"+values.Encode(),
		nil,
	)
	shared.Must(err)
	request.Header.Set("User-Agent", "Voex/1.0 (+web-search)")
	request.Header.Set("Accept", "application/rss+xml, application/xml, text/xml")
	response, err := aiFetchHTTP.Do(request)
	if err != nil {
		shared.NetworkFailure("Bing RSS 搜索", err)
	}
	defer response.Body.Close()
	data := aiWebRead(response, "Bing RSS 搜索")
	var rss struct {
		XMLName xml.Name `xml:"rss"`
		Channel struct {
			Items []struct {
				Title       string `xml:"title"`
				Link        string `xml:"link"`
				Description string `xml:"description"`
			} `xml:"item"`
		} `xml:"channel"`
	}
	if err := xml.Unmarshal(data, &rss); err != nil {
		shared.NetworkFailure("decode Bing RSS response", err)
	}
	results := make([]aiWebResult, 0, len(rss.Channel.Items))
	for _, item := range rss.Channel.Items {
		_, content := aiWebHTML([]byte("<body>" + item.Description + "</body>"))
		results = append(results, aiWebResult{Title: item.Title, URL: item.Link, Content: content})
	}
	return results
}

func (s *Service) AIWebFetch(ctx context.Context, body shared.Row) shared.Row {
	_, done := s.beginAIWeb(ctx, body)
	defer done()
	raw, ok := body["url"].(string)
	if !ok {
		shared.Fail(http.StatusBadRequest, shared.MsgWebURLRequired)
	}
	target, err := aiWebURL(raw)
	if err != nil {
		shared.Fail(http.StatusBadRequest, shared.MsgWebURLInvalid)
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	shared.Must(err)
	request.Header.Set("User-Agent", "Voex/1.0 (+web-fetch)")
	request.Header.Set("Accept", "text/html, application/xhtml+xml, text/plain, text/markdown")
	response, err := aiFetchHTTP.Do(request)
	if err != nil {
		shared.NetworkFailure("网页抓取", err)
	}
	defer response.Body.Close()
	data := aiWebRead(response, "网页抓取")
	contentType := response.Header.Get("Content-Type")
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	mediaType, parameters, err := mime.ParseMediaType(contentType)
	if err != nil {
		shared.NetworkFailure("parse webpage content type", err)
	}
	if mediaType != "text/html" && mediaType != "application/xhtml+xml" &&
		mediaType != "text/plain" &&
		mediaType != "text/markdown" {
		shared.Fail(http.StatusUnsupportedMediaType, shared.MsgWebMediaUnsupported)
	}
	decoded := data
	// Text/Markdown may start with a long ASCII section before UTF-8 Chinese.
	// HTML's 1024-byte sniff would incorrectly select Windows-1252 for that case.
	// Text/Markdown 在 UTF-8 中文之前可能有很长的 ASCII 内容。
	// 此时，HTML 的前 1024 字节编码探测会错误选择 Windows-1252。
	if mediaType == "text/html" || mediaType == "application/xhtml+xml" ||
		parameters["charset"] != "" ||
		!utf8.Valid(data) {
		reader, err := charset.NewReader(bytes.NewReader(data), contentType)
		if err != nil {
			shared.NetworkFailure("decode webpage charset", err)
		}
		decoded, err = io.ReadAll(io.LimitReader(reader, 4*aiWebMaxBytes+1))
		if err != nil {
			shared.NetworkFailure("decode webpage", err)
		}
		if len(decoded) > 4*aiWebMaxBytes {
			shared.NetworkFailure("decode webpage", errors.New("decoded content exceeds limit"))
		}
	}
	title, content := "", string(decoded)
	if mediaType == "text/html" || mediaType == "application/xhtml+xml" {
		title, content = aiWebHTML(decoded)
	}
	content, truncated := aiWebClip(content, aiWebMaxText)
	if content == "" {
		shared.Fail(http.StatusUnprocessableEntity, shared.MsgWebContentMissing)
	}
	title, _ = aiWebClip(strings.Join(strings.Fields(title), " "), 300)
	return shared.Row{
		"url":       response.Request.URL.String(),
		"title":     title,
		"content":   content,
		"truncated": truncated,
	}
}

// Extract visible text only. Never execute scripts, submit forms, send cookies,
// download embedded resources, or turn page instructions into agent authority.
// 仅提取可见文本；绝不执行脚本、提交表单、发送 Cookie、
// 下载内嵌资源，或把页面指令当作 agent 的授权依据。
func aiWebHTML(data []byte) (string, string) {
	doc, err := html.Parse(bytes.NewReader(data))
	if err != nil {
		return "", ""
	}
	var title, main, article, body *html.Node
	var inspect func(*html.Node)
	inspect = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "title":
				if title == nil {
					title = n
				}
			case "main":
				if main == nil {
					main = n
				}
			case "article":
				if article == nil {
					article = n
				}
			case "body":
				if body == nil {
					body = n
				}
			}
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			inspect(child)
		}
	}
	inspect(doc)
	selected := doc
	if body != nil {
		selected = body
	}
	if article != nil {
		selected = article
	}
	if main != nil {
		selected = main
	}
	return aiWebNodeText(title), aiWebNodeText(selected)
}

func aiWebNodeText(root *html.Node) string {
	var out strings.Builder
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n == nil {
			return
		}
		if n.Type == html.TextNode {
			text := strings.Join(strings.Fields(n.Data), " ")
			if text != "" {
				out.WriteString(text)
				out.WriteByte(' ')
			}
			return
		}
		if n.Type == html.ElementNode {
			switch n.Data {
			case "script",
				"style",
				"noscript",
				"template",
				"svg",
				"canvas",
				"iframe",
				"nav",
				"footer",
				"aside",
				"form",
				"button",
				"input",
				"select",
				"textarea":
				return
			}
			for _, attr := range n.Attr {
				if attr.Key == "hidden" || attr.Key == "aria-hidden" && attr.Val == "true" {
					return
				}
				if attr.Key == "style" {
					style := strings.ReplaceAll(strings.ToLower(attr.Val), " ", "")
					if strings.Contains(style, "display:none") ||
						strings.Contains(style, "visibility:hidden") {
						return
					}
				}
			}
			switch n.Data {
			case "p",
				"div",
				"section",
				"article",
				"main",
				"h1",
				"h2",
				"h3",
				"h4",
				"h5",
				"h6",
				"li",
				"tr",
				"br",
				"pre":
				out.WriteByte('\n')
			}
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
		if n.Type == html.ElementNode {
			switch n.Data {
			case "p",
				"div",
				"section",
				"article",
				"main",
				"h1",
				"h2",
				"h3",
				"h4",
				"h5",
				"h6",
				"li",
				"tr",
				"pre":
				out.WriteByte('\n')
			}
		}
	}
	visit(root)
	lines := make([]string, 0)
	for _, line := range strings.Split(out.String(), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}
