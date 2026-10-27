package service

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"golang.org/x/crypto/argon2"
	"strconv"
	"strings"
	"time"
	"voex-server/internal/shared"
)

const accessSeconds = 900

func randomPassword() string { return shared.RandomToken(32) }
func (s *Service) signAccess(user shared.Row, sid string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	now := time.Now().Unix()
	b, err := json.Marshal(shared.Row{"sid": sid, "sub": user["id"], "iss": "voex", "aud": "voex-web", "iat": now, "exp": now + accessSeconds})
	shared.Must(err)
	payload := header + "." + base64.RawURLEncoding.EncodeToString(b)
	h := hmac.New(sha256.New, s.secret)
	h.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func (s *Service) verifyAccess(token string, ignoreExpiry bool) (shared.Row, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, false
	}
	header, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, false
	}
	var h shared.Row
	if json.Unmarshal(header, &h) != nil || shared.String(h["alg"]) != "HS256" {
		return nil, false
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return nil, false
	}
	b, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, false
	}
	var p shared.Row
	if json.Unmarshal(b, &p) != nil {
		return nil, false
	}
	sub, subOK := p["sub"].(string)
	sid, sidOK := p["sid"].(string)
	if !subOK || !sidOK || sub == "" || sid == "" || shared.String(p["iss"]) != "voex" {
		return nil, false
	}
	aud := shared.String(p["aud"]) == "voex-web"
	if a, ok := p["aud"].([]any); ok {
		for _, v := range a {
			aud = aud || shared.String(v) == "voex-web"
		}
	}
	if !aud {
		return nil, false
	}
	now := time.Now().Unix()
	if nbf, ok := p["nbf"]; ok && shared.Int64(nbf) > now {
		return nil, false
	}
	if !ignoreExpiry {
		exp, ok := p["exp"].(float64)
		iat, iatOK := p["iat"].(float64)
		if !ok || !iatOK || int64(exp) <= now || int64(iat)+accessSeconds <= now {
			return nil, false
		}
	}
	return p, true
}

func hashPassword(password string) string {
	salt := make([]byte, 16)
	_, err := rand.Read(salt)
	shared.Must(err)
	hash := argon2.IDKey([]byte(password), salt, 2, 19456, 1, 32)
	return "$argon2id$v=19$m=19456,t=2,p=1$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(hash)
}

func verifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	// PHC parameters are named; node-argon2 emits m,p,t while other encoders
	// emit m,t,p. Accept either order without weakening the resource bounds.
	params := map[string]uint64{}
	for _, item := range strings.Split(parts[3], ",") {
		key, value, ok := strings.Cut(item, "=")
		if !ok {
			return false
		}
		if key != "m" && key != "t" && key != "p" {
			return false
		}
		if _, exists := params[key]; exists {
			return false
		}
		n, e := strconv.ParseUint(value, 10, 32)
		if e != nil {
			return false
		}
		params[key] = n
	}
	memory, iterations, parallel := params["m"], params["t"], params["p"]
	if len(params) != 3 || memory < 8 || memory > 262144 || iterations < 1 || iterations > 10 || parallel < 1 || parallel > 16 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 8 || len(salt) > 128 {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) < 16 || len(expected) > 64 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, uint32(iterations), uint32(memory), uint8(parallel), uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func (s *Service) hashSlot(fn func()) {
	select {
	case s.hashSlots <- struct{}{}:
		defer func() { <-s.hashSlots }()
		fn()
	default:
		shared.Fail(429, "登录服务繁忙，请稍后重试")
	}
}
