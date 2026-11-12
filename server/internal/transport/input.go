package transport

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
	"voex-server/internal/shared"
)

func Body(c *gin.Context) shared.Row         { return BodyRequest(c.Request) }
func BodyRequest(r *http.Request) shared.Row { return BodyRequestLimit(r, 2*1024*1024) }

// BodyRequestLimit is reserved for endpoints that explicitly accept larger validated payloads.
// BodyRequestLimit 预留给显式接受更大且经过验证的载荷的端点。
func BodyRequestLimit(r *http.Request, maximum int64) shared.Row {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		shared.Fail(http.StatusBadRequest, shared.MustBeMessage("请求体", shared.MsgJSONObjectType))
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, maximum+1))
	shared.Must(err)
	if int64(len(b)) > maximum {
		shared.Fail(http.StatusRequestEntityTooLarge, shared.SizeLimitMessage("请求内容"))
	}
	if !utf8.Valid(b) || !shared.ValidJSONUnicode(b) {
		shared.Fail(http.StatusBadRequest, shared.MsgRequestFormatInvalid)
	}
	var obj shared.Row
	d := json.NewDecoder(strings.NewReader(string(b)))
	d.UseNumber()
	if d.Decode(&obj) != nil || obj == nil {
		shared.Fail(http.StatusBadRequest, shared.MustBeMessage("请求体", shared.MsgJSONObjectType))
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		shared.Fail(http.StatusBadRequest, shared.MsgRequestFormatInvalid)
	}
	return obj
}
