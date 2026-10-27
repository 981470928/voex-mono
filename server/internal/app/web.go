package app

import (
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"voex-server/internal/config"
)

func openWebRoot(name string) (*os.Root, error) {
	if !filepath.IsAbs(name) {
		return nil, fmt.Errorf("VOEX_WEB_ROOT must be an absolute path")
	}
	root, err := os.OpenRoot(name)
	if err != nil {
		return nil, fmt.Errorf("VOEX_WEB_ROOT must point to a readable frontend build directory")
	}
	file, err := root.Open("index.html")
	if err != nil {
		root.Close()
		return nil, fmt.Errorf("frontend index.html is missing; initialize and build the project first")
	}
	info, statErr := file.Stat()
	file.Close()
	if statErr != nil || !info.Mode().IsRegular() {
		root.Close()
		return nil, fmt.Errorf("frontend index.html must be a regular file")
	}
	return root, nil
}

func checkWebRoot(name string) (func(), error) {
	// Initialization checks the database before producing the frontend bundle.
	if !filepath.IsAbs(name) {
		return nil, fmt.Errorf("VOEX_WEB_ROOT must be an absolute path")
	}
	root, err := os.OpenRoot(name)
	if err != nil {
		return nil, fmt.Errorf("VOEX_WEB_ROOT must point to a readable frontend build directory")
	}
	return func() { root.Close() }, nil
}

func collaborationTarget(raw string) (*url.URL, error) {
	target, err := url.Parse(raw)
	if err != nil || target.Scheme != "http" || target.User != nil || target.RawQuery != "" || target.Fragment != "" || (target.Path != "" && target.Path != "/") {
		return nil, fmt.Errorf("VOEX_COLLAB_URL must be a loopback HTTP origin")
	}
	host := target.Hostname()
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return nil, fmt.Errorf("VOEX_COLLAB_URL must be a loopback HTTP origin")
	}
	if port := target.Port(); port != "" {
		if err := validPort("VOEX_COLLAB_URL port", port); err != nil {
			return nil, err
		}
	}
	return target, nil
}

// deploymentHandler enables the optional single-port frontend gateway. API-only deployments are unchanged.
func deploymentHandler(api http.Handler, cfg config.Config) (http.Handler, func(), error) {
	name := config.Env("VOEX_WEB_ROOT", "")
	if name == "" {
		return api, func() {}, nil
	}
	root, err := openWebRoot(name)
	if err != nil {
		return nil, nil, err
	}
	closeRoot := func() { root.Close() }
	var proxy *httputil.ReverseProxy
	if cfg.Collaboration.Enabled {
		target, err := collaborationTarget(cfg.Collaboration.URL)
		if err != nil {
			closeRoot()
			return nil, nil, err
		}
		proxy = httputil.NewSingleHostReverseProxy(target)
		proxy.FlushInterval = -1
		proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "collaboration service unavailable", http.StatusBadGateway)
		}
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if proxy != nil && r.URL.Path == "/api/collab/ws" {
			proxy.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") ||
			strings.HasPrefix(r.URL.Path, "/internal/collab/") {
			api.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path == "/" || r.URL.Path == "/app" {
			http.Redirect(w, r, "/app/", http.StatusTemporaryRedirect)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/app/") {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/app/"), "/")
		if name == "" {
			name = "index.html"
		}
		if strings.ContainsAny(name, "\\\x00") || !fs.ValidPath(name) {
			http.NotFound(w, r)
			return
		}
		for _, part := range strings.Split(name, "/") {
			if strings.HasPrefix(part, ".") {
				http.NotFound(w, r)
				return
			}
		}
		file, err := root.Open(name)
		if err != nil {
			// Only navigation requests fall back to the SPA. Missing assets remain 404.
			if !os.IsNotExist(err) || path.Ext(name) != "" || strings.HasPrefix(name, "assets/") || strings.HasPrefix(name, "vendor/") {
				http.NotFound(w, r)
				return
			}
			name = "index.html"
			file, err = root.Open(name)
		}
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		if name == "index.html" {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeContent(w, r, name, info.ModTime(), file)
	})
	return handler, closeRoot, nil
}
