package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"voex-server/internal/shared"
)

func (s *Service) aiQueritSearch(ctx context.Context, query string, limit int) []aiWebResult {
	payload, err := json.Marshal(shared.Row{"query": query, "count": limit, "needContent": false})
	shared.Must(err)
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"https://api.querit.ai/v1/search",
		bytes.NewReader(payload),
	)
	shared.Must(err)
	key := s.webSearchKeys["querit"]
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := aiSearchHTTP.Do(request)
	if err != nil {
		shared.NetworkFailure("Querit search", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		shared.UpstreamFailure("Querit search", response.StatusCode)
	}
	data := aiWebRead(response, "Querit 搜索")
	if key != "" && bytes.Contains(data, []byte(key)) {
		shared.NetworkFailure("Querit response", errors.New("credential detected in response"))
	}
	var envelope struct {
		Code    *int `json:"error_code"`
		Results *struct {
			Items *[]struct {
				Title   string `json:"title"`
				URL     string `json:"url"`
				Snippet string `json:"snippet"`
			} `json:"result"`
		} `json:"results"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		shared.NetworkFailure("decode Querit response", err)
	}
	if envelope.Code == nil {
		shared.NetworkFailure("decode Querit response", errors.New("missing result code"))
	}
	// Querit also reports failures in error_code on HTTP 200 responses.
	// Never echo error_msg because it may include request content or credentials.
	// Querit 也会在 HTTP 200 响应中通过 error_code 报告失败。
	// 绝不回传 error_msg，因为其中可能包含请求内容或凭据。
	if *envelope.Code != http.StatusOK {
		shared.UpstreamFailure("Querit application result", *envelope.Code)
	}
	if envelope.Results == nil || envelope.Results.Items == nil {
		shared.NetworkFailure("decode Querit response", errors.New("invalid response envelope"))
	}
	results := make([]aiWebResult, 0, len(*envelope.Results.Items))
	for _, item := range *envelope.Results.Items {
		results = append(
			results,
			aiWebResult{Title: item.Title, URL: item.URL, Content: item.Snippet},
		)
	}
	return results
}
