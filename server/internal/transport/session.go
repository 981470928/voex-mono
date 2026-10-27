package transport

import (
	"net/http"
	"strings"
	"time"
	"voex-server/internal/security"
)

func Cookie(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return c.Value
}
func AccessToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if header == "" {
		return Cookie(r, "voex_access")
	}
	parts := strings.Split(header, " ")
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.ContainsAny(parts[1], "\t\r\n ") {
		return ""
	}
	return parts[1]
}
func SessionCookie(w http.ResponseWriter, r *http.Request, name, path, value string, seconds int) {
	c := &http.Cookie{Name: name, Value: value, Path: path, HttpOnly: true, Secure: security.SecureRequest(r), SameSite: http.SameSiteStrictMode, MaxAge: seconds, Expires: time.Now().Add(time.Duration(seconds) * time.Second)}
	if seconds < 0 {
		c.Expires = time.Unix(0, 0)
	}
	http.SetCookie(w, c)
}
func ClearSession(w http.ResponseWriter, r *http.Request) {
	SessionCookie(w, r, "voex_access", "/api", "", -1)
	SessionCookie(w, r, "voex_refresh", "/api/auth", "", -1)
}
