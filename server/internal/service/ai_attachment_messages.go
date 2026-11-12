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

func aiMessageObject(value any) (map[string]any, bool) {
	switch object := value.(type) {
	case map[string]any:
		return object, true
	case shared.Row:
		return map[string]any(object), true
	default:
		return nil, false
	}
}

// Only an owned, persisted attachment reference may produce upstream media blocks.
// 只有属于当前用户且已持久化的附件引用，才可生成发送给上游的媒体块。
func (s *Service) expandAIAttachmentMessages(
	ctx context.Context,
	model shared.Row,
	messages []any,
) []any {
	user := shared.String(identity.User(ctx)["id"])
	return s.tx(ctx, false, func(db *gorm.DB) any {
		cache := map[string]map[string]AIAttachment{}
		size := 0
		result := make([]any, 0, len(messages))
		var expand func(any, string, bool) []any
		expand = func(value any, role string, nested bool) []any {
			block, ok := aiMessageObject(value)
			if !ok {
				shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("模型消息内容"))
			}
			kind, ok := block["type"].(string)
			if !ok {
				shared.Fail(http.StatusBadRequest, shared.MsgAIMessageTypeRequired)
			}
			switch kind {
			case "text":
				if _, ok := block["text"].(string); !ok {
					shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("文字消息"))
				}
				return []any{block}
			case "thinking", "redacted_thinking", "tool_use":
				if role != "assistant" || nested {
					shared.Fail(http.StatusBadRequest, shared.MsgAIMessageRoleMismatch)
				}
				return []any{block}
			case "tool_result":
				if role != "user" || nested {
					shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("工具返回消息"))
				}
				copy := shared.Row{}
				for key, item := range block {
					copy[key] = item
				}
				if content, ok := block["content"].([]any); ok {
					expanded := []any{}
					for _, item := range content {
						expanded = append(expanded, expand(item, role, true)...)
					}
					copy["content"] = expanded
				} else if _, ok := block["content"].(string); !ok {
					shared.Fail(
						http.StatusBadRequest,
						shared.MustBeMessage("工具返回内容", shared.MsgTextType),
					)
				}
				return []any{copy}
			case "voex_attachment":
				if !shared.Bool(model["multimodal_enabled"]) {
					shared.Fail(http.StatusBadRequest, shared.MsgAIMultimodalRequired)
				}
				if role != "user" || nested || len(block) != 3 {
					shared.Fail(http.StatusBadRequest, shared.MsgAIAttachmentReferenceRequired)
				}
				turnID, turnOK := block["turn_id"].(string)
				attachmentID, attachmentOK := block["attachment_id"].(string)
				if !turnOK ||
					!attachmentOK ||
					!aiHistoryID.MatchString(turnID) ||
					!aiHistoryID.MatchString(attachmentID) {
					shared.Fail(http.StatusBadRequest, shared.MsgAIAttachmentReferenceInvalid)
				}
				attachments, loaded := cache[turnID]
				if !loaded {
					turn := repository.AITurn(db, user, turnID)
					if turn == nil {
						shared.Fail(http.StatusNotFound, shared.MsgAIAttachmentConversationMissing)
					}
					s.FindDocument(db, ctx, shared.String(turn["source_key"]), "read", false)
					attachments = map[string]AIAttachment{}
					for _, item := range storedAIAttachments(turn["attachments"]) {
						attachments[item.ID] = item
					}
					cache[turnID] = attachments
				}
				item, exists := attachments[attachmentID]
				if !exists {
					shared.Fail(http.StatusNotFound, shared.MsgAIConversationAttachmentMissing)
				}
				size += len(item.Text) + len(item.Data) + len(item.Name) + 256
				if size > aiProviderRequestSize-2*1024*1024 {
					shared.Fail(
						http.StatusRequestEntityTooLarge,
						shared.MsgAIAttachmentRequestTooLarge,
					)
				}
				if item.Kind == "text" {
					return []any{aiAttachmentTextBlock(item)}
				}
				if item.Kind != "image" || !strings.HasPrefix(item.MIME, "image/") {
					shared.Fail(http.StatusBadRequest, shared.MsgAIAttachmentTypeInvalid)
				}
				label := shared.Row{"type": "text", "text": "用户上传的图片：" + item.Name}
				if model["protocol"] == "anthropic" {
					return []any{
						label,
						shared.Row{
							"type": "image",
							"source": shared.Row{
								"type":       "base64",
								"media_type": item.MIME,
								"data":       item.Data,
							},
						},
					}
				}
				return []any{
					label,
					shared.Row{
						"type": "image_url",
						"image_url": shared.Row{
							"url": "data:" +
								item.MIME +
								";base64," +
								item.Data,
						},
					},
				}
			default:
				// Raw data URLs, external images, document/audio/video blocks and unknown media are
				// rejected.
				// 拒绝原始 data URL、外部图片、文档/音频/视频块及未知媒体类型。
				if !shared.Bool(model["multimodal_enabled"]) {
					shared.Fail(http.StatusBadRequest, shared.MsgAITextOnly)
				}
				shared.Fail(http.StatusBadRequest, shared.MsgAIAttachmentUploadRequired)
			}
			return nil
		}
		for _, value := range messages {
			message, ok := aiMessageObject(value)
			if !ok {
				shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("模型消息"))
			}
			role, ok := message["role"].(string)
			if !ok ||
				(role != "system" &&
					role != "user" &&
					role != "assistant" &&
					role != "tool") {
				shared.Fail(http.StatusBadRequest, shared.MsgAIMessageRoleInvalid)
			}
			allowed := map[string]bool{
				"role":              true,
				"content":           true,
				"tool_calls":        true,
				"tool_call_id":      true,
				"reasoning_content": true,
				"name":              true,
			}
			for key := range message {
				if !allowed[key] {
					shared.Fail(http.StatusBadRequest, shared.MsgAIMessageFieldsInvalid)
				}
			}
			copy := shared.Row{}
			for key, item := range message {
				copy[key] = item
			}
			switch content := message["content"].(type) {
			case []any:
				expanded := []any{}
				for _, block := range content {
					expanded = append(expanded, expand(block, role, false)...)
				}
				copy["content"] = expanded
			case string:
			case nil:
				if role != "assistant" {
					shared.Fail(http.StatusBadRequest, shared.MsgAIMessageTextRequired)
				}
			default:
				shared.Fail(http.StatusBadRequest, shared.InvalidFormatMessage("模型消息内容"))
			}
			result = append(result, copy)
		}
		return result
	}).([]any)
}

func aiAttachmentJSON(attachments []AIAttachment) string {
	if attachments == nil {
		attachments = []AIAttachment{}
	}
	data, err := json.Marshal(attachments)
	shared.Must(err)
	return string(data)
}
