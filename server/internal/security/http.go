package security

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
	"voex-server/internal/shared"
)

type limitEntry struct {
	Count   int
	Expires time.Time
}
type Limiter struct {
	sync.Mutex
	entries map[string]limitEntry
	nextGC  time.Time
}

func NewLimiter() *Limiter { return &Limiter{entries: map[string]limitEntry{}} }
func RemoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	a, _ := netip.ParseAddr(host)
	if a.IsLoopback() {
		parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		for i := len(parts) - 1; i >= 0; i-- {
			candidate := strings.TrimSpace(parts[i])
			ip, e := netip.ParseAddr(candidate)
			if e != nil {
				continue
			}
			host = candidate
			if !ip.IsLoopback() {
				break
			}
		}
	}
	return host
}

func SecureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	ip, _ := netip.ParseAddr(host)
	return ip.IsLoopback() &&
		strings.EqualFold(
			strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]),
			"https",
		)
}

func RateIP(r *http.Request) string {
	raw := RemoteIP(r)
	a, e := netip.ParseAddr(raw)
	if e != nil {
		return raw
	}
	a = a.Unmap()
	if a.Is6() {
		return netip.PrefixFrom(a, 56).Masked().String()
	}
	return a.String()
}

func (s *Limiter) LimitKey(key string, max int, window time.Duration) func() {
	now := time.Now()
	s.Lock()
	defer s.Unlock()
	if now.After(s.nextGC) {
		for k, e := range s.entries {
			if !now.Before(e.Expires) {
				delete(s.entries, k)
			}
		}
		s.nextGC = now.Add(time.Minute)
	}
	e := s.entries[key]
	if !now.Before(e.Expires) {
		e = limitEntry{Expires: now.Add(window)}
	}
	e.Count++
	s.entries[key] = e
	if e.Count > max {
		shared.Fail(http.StatusTooManyRequests, shared.MsgTooManyRequests)
	}
	return func() {
		s.Lock()
		defer s.Unlock()
		v := s.entries[key]
		if v.Expires.Equal(e.Expires) && v.Count > 0 {
			v.Count--
			s.entries[key] = v
		}
	}
}

func (s *Limiter) Limit(r *http.Request, bucket string, max int, window time.Duration) {
	s.LimitKey(bucket+":"+RateIP(r), max, window)
}
