package service

import (
	"context"
	"io"
	"net/http"
	"sync"
	"time"
	"voex-server/internal/identity"
	"voex-server/internal/shared"

	"github.com/gabriel-vasile/mimetype"
	"gorm.io/gorm"
)

const documentImageMaxBytes = 20 * 1024 * 1024

var documentImageActive sync.Map

// FetchDocumentImage reads public image bytes only. Attachment creation continues
// through UploadAttachment, which independently rechecks the document permission.
// FetchDocumentImage 仅读取公开图片字节；附件仍通过 UploadAttachment 创建，
// 后者会独立重新检查文档权限。
func (s *Service) FetchDocumentImage(ctx context.Context, body shared.Row) ([]byte, string) {
	fileKey := shared.Key(body["fileKey"], "文档标识")
	s.tx(
		ctx,
		false,
		func(db *gorm.DB) any { return s.FindDocument(db, ctx, fileKey, "write", false) },
	)
	raw, ok := body["url"].(string)
	if !ok {
		shared.Fail(http.StatusBadRequest, shared.MsgImageURLRequired)
	}
	target, err := aiWebURL(raw)
	if err != nil {
		shared.Fail(http.StatusBadRequest, shared.MsgImageURLInvalid)
	}
	userID := shared.String(identity.User(ctx)["id"])
	if _, loaded := documentImageActive.LoadOrStore(userID, true); loaded {
		shared.Fail(http.StatusTooManyRequests, shared.MsgImageRequestActive)
	}
	defer documentImageActive.Delete(userID)

	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	shared.Must(err)
	request.Header.Set("User-Agent", "Voex/1.0 (+image-import)")
	request.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/gif")
	// aiFetchHTTP validates every redirect and pins public DNS addresses in aiDial.
	// No browser cookies, authorization headers or search-engine credentials are sent.
	// aiFetchHTTP 检查每次重定向，并在 aiDial 中固定 DNS 解析得到的公网地址。
	// 不发送浏览器 Cookie、授权请求头或搜索引擎凭据。
	response, err := aiFetchHTTP.Do(request)
	if err != nil {
		shared.NetworkFailure("fetch document image", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		shared.UpstreamFailure("fetch document image", response.StatusCode)
	}
	if response.ContentLength > documentImageMaxBytes {
		shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgDocumentImageTooLarge)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, documentImageMaxBytes+1))
	if err != nil {
		shared.NetworkFailure("fetch document image", err)
	}
	if len(data) > documentImageMaxBytes {
		shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgDocumentImageTooLarge)
	}
	// Detect the actual bytes rather than trusting a remote Content-Type header.
	// 根据实际字节检测类型，不信任远程 Content-Type 响应头。
	contentType := mimetype.Detect(data).String()
	switch contentType {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif":
	default:
		shared.Fail(http.StatusUnsupportedMediaType, shared.MsgDocumentImageUnsupported)
	}
	// Do not return a late response after edit permission has been revoked.
	// 编辑权限撤销后，不再返回迟到的响应。
	s.tx(
		ctx,
		false,
		func(db *gorm.DB) any { return s.FindDocument(db, ctx, fileKey, "write", false) },
	)
	return data, contentType
}
