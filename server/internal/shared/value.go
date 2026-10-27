package shared

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type Row map[string]any
type HTTPError struct {
	Status  int
	Message string
}

func (e HTTPError) Error() string { return e.Message }

func Fail(status int, message string) { panic(HTTPError{status, message}) }

func Must(err error) {
	if err != nil {
		panic(err)
	}
}

func String(v any) string {
	if v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return x
	case []byte:
		return string(x)
	default:
		return fmt.Sprint(v)
	}
}

func Int64(v any) int64 {
	switch x := v.(type) {
	case int64:
		return x
	case int:
		return int64(x)
	case uint64:
		return int64(x)
	case float64:
		return int64(x)
	case json.Number:
		n, _ := x.Int64()
		return n
	default:
		n, _ := strconv.ParseInt(String(v), 10, 64)
		return n
	}
}

func Bool(v any) bool {
	if v == nil {
		return false
	}
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return x != "" && x != "0"
	default:
		return Int64(v) != 0
	}
}

func Timestamp(v any) string {
	if t, ok := v.(time.Time); ok {
		return t.UTC().Format("2006-01-02T15:04:05.000Z")
	}
	return String(v)
}

func Policy(v any) Row {
	if r, ok := v.(Row); ok {
		return r
	}
	if r, ok := v.(map[string]any); ok {
		return Row(r)
	}
	var r Row
	if json.Unmarshal([]byte(String(v)), &r) != nil || r == nil {
		return Row{"mode": "restricted"}
	}
	return r
}

func Key(v any, label string) string {
	x, ok := v.(string)
	if !ok || strings.TrimSpace(x) == "" {
		Fail(400, label+"必须是非空字符串")
	}
	if utf8.RuneCountInString(x) > 64 || x != strings.TrimSpace(x) {
		Fail(400, label+"不能超过 64 个字符或包含首尾空白")
	}
	return x
}

func Name(v any, label string) string {
	x, ok := v.(string)
	if !ok || strings.TrimSpace(x) == "" {
		Fail(400, label+"必须是非空字符串")
	}
	x = strings.TrimSpace(x)
	if utf8.RuneCountInString(x) > 255 {
		Fail(400, label+"不能超过 255 个字符")
	}
	return x
}

func RandomToken(n int) string {
	b := make([]byte, n)
	_, err := rand.Read(b)
	Must(err)
	return base64.RawURLEncoding.EncodeToString(b)
}

func UUID() string {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	Must(err)
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	h := hex.EncodeToString(b)
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

func PublicKey() string { return strings.ReplaceAll(UUID(), "-", "")[:16] }

func Digest(v string) string { h := sha256.Sum256([]byte(v)); return hex.EncodeToString(h[:]) }

func Creator(u Row) Row { return Row{"id": u["id"], "name": u["name"], "avator": u["avator"]} }

func ValidJSONUnicode(b []byte) bool {
	for i := 0; i < len(b); i++ {
		if b[i] != '\\' {
			continue
		}
		i++
		if i >= len(b) {
			return false
		}
		if b[i] != 'u' {
			continue
		}
		if i+4 >= len(b) {
			return false
		}
		v, e := strconv.ParseUint(string(b[i+1:i+5]), 16, 16)
		if e != nil {
			return false
		}
		i += 4
		if v >= 0xDC00 && v <= 0xDFFF {
			return false
		}
		if v >= 0xD800 && v <= 0xDBFF {
			if i+6 >= len(b) || b[i+1] != '\\' || b[i+2] != 'u' {
				return false
			}
			low, e := strconv.ParseUint(string(b[i+3:i+7]), 16, 16)
			if e != nil || low < 0xDC00 || low > 0xDFFF {
				return false
			}
			i += 6
		}
	}
	return true
}

func Characters(v any, label string, min, max int) string {
	value, ok := v.(string)
	if !ok || !utf8.ValidString(value) {
		Fail(400, label+"格式错误")
	}
	length := utf8.RuneCountInString(value)
	if length < min || length > max {
		Fail(400, fmt.Sprintf("%s需要 %d–%d 个字符", label, min, max))
	}
	return value
}
