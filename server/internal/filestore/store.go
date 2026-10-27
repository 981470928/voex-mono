package filestore

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"regexp"

	_ "golang.org/x/image/webp"
	"voex-server/internal/shared"
)

var directoryPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}(/[A-Za-z0-9_-]{1,64})*$`)
var attachmentHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var assetStoragePattern = regexp.MustCompile(`^[a-f0-9-]{36}(\.webp)?$`)

func SafeDirectory(value any) string {
	directory, ok := value.(string)
	if !ok || len(directory) > 255 || !directoryPattern.MatchString(directory) {
		shared.Fail(400, "path 只能包含字母、数字、短横线、下划线和分层斜杠")
	}
	return directory
}

type Upload struct {
	Path   string
	Name   string
	MIME   string
	Size   int64
	Fields shared.Row
}

// Read the multipart stream with the same file, field, and size limits as the previous API.
func (s *Store) ReadUpload(w http.ResponseWriter, r *http.Request, asset bool) (upload Upload) {
	maximum := int64(300 * 1024 * 1024)
	if asset {
		maximum = 200 * 1024 * 1024
	}
	upload.Fields = shared.Row{}
	complete := false
	defer func() {
		if !complete && upload.Path != "" {
			_ = os.Remove(upload.Path)
		}
	}()
	r.Body = http.MaxBytesReader(w, r.Body, maximum+1024*1024)
	reader, err := r.MultipartReader()
	if err != nil {
		shared.Fail(400, "请求格式错误，请检查上传表单")
	}
	maxFields, maxParts, maxFieldSize, maxNameSize := 3, 5, int64(4096), 100
	if asset {
		maxFields, maxParts, maxFieldSize, maxNameSize = 1, 3, 255, 30
	}
	fields, parts := 0, 0
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			uploadReadError(err)
		}
		parts++
		name := part.FormName()
		if parts > maxParts || len(name) > maxNameSize || name == "" {
			shared.Fail(400, "上传字段或文件数量不合法")
		}
		if part.FileName() == "" {
			fields++
			if fields > maxFields {
				shared.Fail(400, "上传字段或文件数量不合法")
			}
			data, err := io.ReadAll(io.LimitReader(part, maxFieldSize+1))
			if err != nil {
				uploadReadError(err)
			}
			if int64(len(data)) > maxFieldSize {
				shared.Fail(400, "上传字段或文件数量不合法")
			}
			if _, exists := upload.Fields[name]; exists {
				shared.Fail(400, "上传字段或文件数量不合法")
			}
			upload.Fields[name] = string(data)
		} else {
			if name != "file" || upload.Path != "" {
				shared.Fail(400, "上传字段或文件数量不合法")
			}
			file, filename, err := s.createUpload()
			shared.Must(err)
			upload.Path, upload.Name, upload.MIME = filename, part.FileName(), part.Header.Get("Content-Type")
			upload.Size, err = io.Copy(file, io.LimitReader(part, maximum+1))
			closeErr := file.Close()
			if err != nil {
				uploadReadError(err)
			}
			shared.Must(closeErr)
			if upload.Size > maximum {
				shared.Fail(413, "上传文件超过大小限制")
			}
		}
		if err := part.Close(); err != nil {
			uploadReadError(err)
		}
	}
	complete = true
	return upload
}

func uploadReadError(err error) {
	var oversized *http.MaxBytesError
	if errors.As(err, &oversized) {
		shared.Fail(413, "上传文件超过大小限制")
	}
	var pathError *os.PathError
	if errors.As(err, &pathError) {
		shared.Must(err)
	}
	shared.Fail(400, "请求格式错误，请检查上传表单")
}

func ComputeHash(filename string) string {
	file, err := os.Open(filename)
	shared.Must(err)
	defer file.Close()
	hash := sha256.New()
	_, err = io.Copy(hash, file)
	shared.Must(err)
	return hex.EncodeToString(hash.Sum(nil))
}

// validatedImage checks the actual image bytes without altering the uploaded file.
func validatedImage(filename string) (string, error) {
	file, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer file.Close()
	config, format, err := image.DecodeConfig(file)
	if err != nil {
		return "", err
	}
	mimeType := ""
	switch format {
	case "png":
		mimeType = "image/png"
	case "jpeg":
		mimeType = "image/jpeg"
	case "webp":
		mimeType = "image/webp"
	default:
		return "", fmt.Errorf("unsupported image format")
	}
	if config.Width < 1 || config.Height < 1 || config.Width > 20000000/config.Height {
		return "", fmt.Errorf("invalid image dimensions")
	}
	if !staticImage(filename, format) {
		return "", fmt.Errorf("animated or malformed image")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	decoded, decodedFormat, err := image.Decode(file)
	if err != nil {
		return "", err
	}
	if decodedFormat != format || decoded.Bounds().Dx() != config.Width || decoded.Bounds().Dy() != config.Height {
		return "", fmt.Errorf("inconsistent image dimensions")
	}
	return mimeType, nil
}

// Inspect animation chunks so a decoder cannot silently accept only the first frame.
func staticImage(filename string, format string) bool {
	file, err := os.Open(filename)
	if err != nil {
		return false
	}
	defer file.Close()
	if format == "jpeg" {
		return true
	}
	header := make([]byte, 12)
	if format == "png" {
		if _, err = io.ReadFull(file, header[:8]); err != nil || string(header[:8]) != "\x89PNG\r\n\x1a\n" {
			return false
		}
		for {
			if _, err = io.ReadFull(file, header[:8]); err != nil {
				return false
			}
			size := int64(binary.BigEndian.Uint32(header[:4]))
			kind := string(header[4:8])
			if kind == "acTL" {
				return false
			}
			if kind == "IEND" {
				_, err = io.ReadFull(file, header[:4])
				return size == 0 && err == nil
			}
			if _, err = io.CopyN(io.Discard, file, size+4); err != nil {
				return false
			}
		}
	}
	if format == "webp" {
		if _, err = io.ReadFull(file, header); err != nil || string(header[:4]) != "RIFF" || string(header[8:12]) != "WEBP" {
			return false
		}
		info, err := file.Stat()
		remaining := int64(binary.LittleEndian.Uint32(header[4:8])) - 4
		if err != nil || remaining < 0 || remaining+12 != info.Size() {
			return false
		}
		for remaining > 0 {
			if remaining < 8 {
				return false
			}
			if _, err = io.ReadFull(file, header[:8]); err != nil {
				return false
			}
			size := int64(binary.LittleEndian.Uint32(header[4:8]))
			remaining -= 8
			padded := size + size%2
			if padded > remaining {
				return false
			}
			if string(header[:4]) == "ANIM" || string(header[:4]) == "ANMF" {
				return false
			}
			if _, err = io.CopyN(io.Discard, file, padded); err != nil {
				return false
			}
			remaining -= padded
		}
		return true
	}
	return false
}

func IsImageMIME(mimeType string) bool {
	return mimeType == "image/png" || mimeType == "image/jpeg" || mimeType == "image/webp"
}

// Remove cleans up an incoming multipart body after its request finishes.
func (u Upload) Remove() {
	if u.Path != "" {
		_ = os.Remove(u.Path)
	}
}

type StoredAsset struct {
	StorageName, MIME string
	Size              int64
	key               string
	store             *Store
}

// Remove rolls back an uncommitted UUID asset, even after the request is canceled.
func (a StoredAsset) Remove() {
	if a.store != nil && a.key != "" {
		a.store.removeAsset(a.key)
	}
}

// SaveAsset validates supported images and stores their original bytes in the private local volume.
func (s *Store) SaveAsset(ctx context.Context, upload Upload, id, directory string) (stored StoredAsset) {
	SafeDirectory(directory)
	stored = StoredAsset{StorageName: id, MIME: "application/octet-stream", Size: upload.Size}
	source := upload.Path
	if directory == "avator" || directory == "thumbnail" {
		maximum := int64(20)
		if directory == "avator" {
			maximum = 5
		}
		if upload.Size > maximum*1024*1024 {
			shared.Fail(413, fmt.Sprintf("图片不能超过 %d MB", maximum))
		}
		mimeType, err := validatedImage(source)
		if err != nil {
			shared.Fail(400, "请选择有效的静态 PNG、JPEG 或 WebP 图片（最多 2000 万像素）")
		}
		stored.MIME = mimeType
	}
	key := s.AssetKey(directory, stored.StorageName)
	if err := s.putObject(ctx, key, source, stored.MIME); err != nil {
		if storageStatus(err) == http.StatusPreconditionFailed {
			shared.Fail(409, "资源标识冲突，请重试")
		}
		storageFailure("upload asset", err)
	}
	stored.key, stored.store = key, s
	return stored
}

func (s *Store) AssetKey(directory, storageName string) string {
	SafeDirectory(directory)
	if !assetStoragePattern.MatchString(storageName) {
		shared.Fail(404, "文件不存在")
	}
	return "assets/" + directory + "/" + storageName
}
func (s *Store) AttachmentKey(hash string) string {
	if !attachmentHashPattern.MatchString(hash) {
		shared.Fail(404, "附件不存在")
	}
	return "attachments/" + hash
}
func (s *Store) SaveAttachment(ctx context.Context, upload Upload, hash string) {
	err := s.putObject(ctx, s.AttachmentKey(hash), upload.Path, "application/octet-stream")
	// Content-addressed objects are immutable and can be shared across documents.
	if err != nil && storageStatus(err) != http.StatusPreconditionFailed {
		storageFailure("upload attachment", err)
	}
}
