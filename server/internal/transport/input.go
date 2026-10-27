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

func Body(c *gin.Context) shared.Row { return BodyRequest(c.Request) }
func BodyRequest(r *http.Request) shared.Row {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		shared.Fail(400, "请求体必须是 JSON 对象")
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 2*1024*1024+1))
	shared.Must(err)
	if len(b) > 2*1024*1024 {
		shared.Fail(413, "请求内容超过大小限制")
	}
	if !utf8.Valid(b) || !shared.ValidJSONUnicode(b) {
		shared.Fail(400, "请求格式错误，请检查 JSON 和路径参数")
	}
	var obj shared.Row
	d := json.NewDecoder(strings.NewReader(string(b)))
	d.UseNumber()
	if d.Decode(&obj) != nil || obj == nil {
		shared.Fail(400, "请求体必须是 JSON 对象")
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		shared.Fail(400, "请求格式错误，请检查 JSON 和路径参数")
	}
	return obj
}
