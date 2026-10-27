package filestore

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"

	"voex-server/internal/shared"
)

// Download carries a previously authorized object and its response policy.
type Download struct {
	Key, Name, MIME, Cache, Missing string
	Inline, SameOrigin              bool
}

// Serve exposes authorized files through the API, never through a public volume.
func (s *Store) Serve(w http.ResponseWriter, r *http.Request, download Download) {
	file, info, err := s.openObject(download.Key)
	if err != nil {
		if storageStatus(err) == http.StatusNotFound {
			shared.Fail(http.StatusNotFound, download.Missing)
		}
		storageFailure("open object", err)
	}
	ctx, cancel := context.WithCancel(r.Context())
	content := &fileReader{ctx: ctx, cancel: cancel, file: file, size: info.Size()}
	defer content.Close()
	if download.SameOrigin {
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	}
	mimeType := download.MIME
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	disposition := "attachment"
	if download.Inline {
		disposition = "inline"
	}
	encoded := strings.ReplaceAll(url.QueryEscape(download.Name), "+", "%20")
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Cache-Control", download.Cache)
	w.Header().Set("Content-Disposition", disposition+"; filename*=UTF-8''"+encoded)
	// Object keys are immutable; include inode metadata so offline replacement
	// also invalidates a previously cached representation.
	identity := fmt.Sprintf("%s:%d:%d", download.Key, info.Size(), info.ModTime().UnixNano())
	w.Header().Set("ETag", fmt.Sprintf("\"%x\"", sha256.Sum256([]byte(identity))))
	response := &downloadResponse{ResponseWriter: w}
	// Limit work from multipart ranges; HTTP permits sending the whole file.
	if ranges := r.Header.Get("Range"); strings.HasPrefix(ranges, "bytes=") && strings.Count(ranges, ",") >= 16 {
		r = r.Clone(r.Context())
		r.Header.Del("Range")
	}
	http.ServeContent(response, r, download.Name, info.ModTime(), content)
	// Multipart ranges may read concurrently. Cancel and synchronize before close.
	_ = content.Close()
	if response.writeErr != nil {
		panic(http.ErrAbortHandler)
	}
	err = content.failure()
	if err == nil && r.Method != http.MethodHead && (response.status == http.StatusOK || response.status == http.StatusPartialContent) {
		if expected, parseErr := strconv.ParseInt(response.Header().Get("Content-Length"), 10, 64); parseErr == nil && response.written != expected {
			err = io.ErrUnexpectedEOF
		}
	}
	if err != nil {
		if response.committed {
			logStorageError("read object", err)
			panic(http.ErrAbortHandler)
		}
		for _, header := range []string{"Content-Type", "Content-Length", "Content-Range", "Content-Disposition", "ETag", "Last-Modified", "Accept-Ranges"} {
			w.Header().Del(header)
		}
		storageFailure("read object", err)
	}
	response.commit()
}

// fileReader preserves seekable ServeContent behavior while recording disk and
// cancellation failures, including reads performed by multipart range goroutines.
type fileReader struct {
	mu           sync.Mutex
	ctx          context.Context
	cancel       context.CancelFunc
	file         *os.File
	size, offset int64
	err          error
	closed       bool
}

func (f *fileReader) Read(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return 0, io.ErrClosedPipe
	}
	if err := f.ctx.Err(); err != nil {
		f.err = err
		return 0, err
	}
	n, err := f.file.Read(p)
	f.offset += int64(n)
	if errors.Is(err, io.EOF) && f.offset < f.size {
		err = io.ErrUnexpectedEOF
	}
	if err != nil && !errors.Is(err, io.EOF) {
		f.err = err
	}
	return n, err
}

func (f *fileReader) Seek(offset int64, whence int) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return 0, io.ErrClosedPipe
	}
	position, err := f.file.Seek(offset, whence)
	if err != nil {
		f.err = err
	} else {
		f.offset = position
	}
	return position, err
}

func (f *fileReader) Close() error {
	f.cancel()
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil
	}
	f.closed = true
	return f.file.Close()
}

func (f *fileReader) failure() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.err
}

// Delay headers until the first body write so initial local read failures can
// become API errors. HEAD, empty files and conditional responses commit at end.
type downloadResponse struct {
	http.ResponseWriter
	status    int
	written   int64
	committed bool
	writeErr  error
}

func (w *downloadResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}

func (w *downloadResponse) Write(p []byte) (int, error) {
	w.commit()
	n, err := w.ResponseWriter.Write(p)
	w.written += int64(n)
	if err != nil {
		w.writeErr = err
	} else if n != len(p) {
		w.writeErr = io.ErrShortWrite
	}
	return n, err
}

func (w *downloadResponse) commit() {
	if !w.committed {
		if w.status == 0 {
			w.status = http.StatusOK
		}
		w.committed = true
		w.ResponseWriter.WriteHeader(w.status)
	}
}
