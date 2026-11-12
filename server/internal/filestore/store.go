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
		shared.Fail(http.StatusBadRequest, shared.MsgStoragePathInvalid)
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
// 读取 multipart 流时，沿用原 API 的文件、字段和大小限制。
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
		shared.Fail(http.StatusBadRequest, shared.MsgUploadFormInvalid)
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
			shared.Fail(http.StatusBadRequest, shared.MsgUploadFieldsInvalid)
		}
		if part.FileName() == "" {
			fields++
			if fields > maxFields {
				shared.Fail(http.StatusBadRequest, shared.MsgUploadFieldsInvalid)
			}
			data, err := io.ReadAll(io.LimitReader(part, maxFieldSize+1))
			if err != nil {
				uploadReadError(err)
			}
			if int64(len(data)) > maxFieldSize {
				shared.Fail(http.StatusBadRequest, shared.MsgUploadFieldsInvalid)
			}
			if _, exists := upload.Fields[name]; exists {
				shared.Fail(http.StatusBadRequest, shared.MsgUploadFieldsInvalid)
			}
			upload.Fields[name] = string(data)
		} else {
			if name != "file" || upload.Path != "" {
				shared.Fail(http.StatusBadRequest, shared.MsgUploadFieldsInvalid)
			}
			file, filename, err := s.createUpload()
			shared.Must(err)
			upload.Path, upload.Name, upload.MIME = filename, part.FileName(), part.Header.Get(
				"Content-Type",
			)
			upload.Size, err = io.Copy(file, io.LimitReader(part, maximum+1))
			closeErr := file.Close()
			if err != nil {
				uploadReadError(err)
			}
			shared.Must(closeErr)
			if upload.Size > maximum {
				shared.Fail(http.StatusRequestEntityTooLarge, shared.SizeLimitMessage("上传文件"))
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
		shared.Fail(http.StatusRequestEntityTooLarge, shared.SizeLimitMessage("上传文件"))
	}
	var pathError *os.PathError
	if errors.As(err, &pathError) {
		shared.Must(err)
	}
	shared.Fail(http.StatusBadRequest, shared.MsgUploadFormInvalid)
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
// validatedImage 检查实际图片字节，不修改上传文件。
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
	if decodedFormat != format || decoded.Bounds().Dx() != config.Width ||
		decoded.Bounds().Dy() != config.Height {
		return "", fmt.Errorf("inconsistent image dimensions")
	}
	return mimeType, nil
}

// Inspect animation chunks so a decoder cannot silently accept only the first frame.
// 检查动画数据块，防止解码器仅接受首帧而未报告问题。
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
		if _, err = io.ReadFull(
			file,
			header[:8],
		); err != nil ||
			string(header[:8]) != "\x89PNG\r\n\x1a\n" {
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
		if _, err = io.ReadFull(
			file,
			header,
		); err != nil || string(header[:4]) != "RIFF" ||
			string(header[8:12]) != "WEBP" {
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
// Remove 在请求结束后清理接收的 multipart 请求体。
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
// Remove 回滚尚未提交的 UUID 资源，即使请求已取消也执行清理。
func (a StoredAsset) Remove() {
	if a.store != nil && a.key != "" {
		a.store.removeAsset(a.key)
	}
}

// SaveAsset validates supported images and stores their original bytes in the private local volume.
// SaveAsset 验证支持的图片，并将原始字节存入私有本地存储卷。
func (s *Store) SaveAsset(
	ctx context.Context,
	upload Upload,
	id, directory string,
) (stored StoredAsset) {
	SafeDirectory(directory)
	stored = StoredAsset{StorageName: id, MIME: "application/octet-stream", Size: upload.Size}
	source := upload.Path
	if directory == "avator" || directory == "thumbnail" {
		maximum := int64(20)
		if directory == "avator" {
			maximum = 5
		}
		if upload.Size > maximum*1024*1024 {
			shared.Fail(
				http.StatusRequestEntityTooLarge,
				shared.MaxSizeMessage("图片", maximum, "MB"),
			)
		}
		mimeType, err := validatedImage(source)
		if err != nil {
			shared.Fail(http.StatusBadRequest, shared.MsgStaticImageInvalid)
		}
		stored.MIME = mimeType
	}
	key := s.AssetKey(directory, stored.StorageName)
	if err := s.putObject(ctx, key, source, stored.MIME); err != nil {
		if storageStatus(err) == http.StatusPreconditionFailed {
			shared.Fail(http.StatusConflict, shared.MsgResourceConflict)
		}
		storageFailure("upload asset", err)
	}
	stored.key, stored.store = key, s
	return stored
}

func (s *Store) AssetKey(directory, storageName string) string {
	SafeDirectory(directory)
	if !assetStoragePattern.MatchString(storageName) {
		shared.Fail(http.StatusNotFound, shared.NotFoundMessage("文件"))
	}
	return "assets/" + directory + "/" + storageName
}
func (s *Store) AttachmentKey(hash string) string {
	if !attachmentHashPattern.MatchString(hash) {
		shared.Fail(http.StatusNotFound, shared.NotFoundMessage("附件"))
	}
	return "attachments/" + hash
}
func (s *Store) SaveAttachment(ctx context.Context, upload Upload, hash string) {
	err := s.putObject(ctx, s.AttachmentKey(hash), upload.Path, "application/octet-stream")
	// Content-addressed objects are immutable and can be shared across documents.
	// 按内容寻址的对象不可变，可以在文档之间共享。
	if err != nil && storageStatus(err) != http.StatusPreconditionFailed {
		storageFailure("upload attachment", err)
	}
}
