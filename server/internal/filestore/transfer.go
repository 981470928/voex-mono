package filestore

import (
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"voex-server/internal/shared"
)

const MaxTransferUpload int64 = 512 << 20

// NewTransferFile creates a private temporary file accepted by SaveAttachment.
// NewTransferFile 创建 SaveAttachment 可接受的私有临时文件。
func (s *Store) NewTransferFile() (*os.File, string) {
	file, filename, err := s.createUpload()
	shared.Must(err)
	return file, filename
}

// OpenTransferAttachment keeps archive reads inside the same rooted storage boundary.
// OpenTransferAttachment 将归档读取限制在同一存储根目录边界内。
func (s *Store) OpenTransferAttachment(hash string) (*os.File, os.FileInfo, error) {
	return s.openObject(s.AttachmentKey(hash))
}

func (s *Store) ReadDocumentUpload(w http.ResponseWriter, r *http.Request) (upload Upload) {
	upload.Fields = shared.Row{}
	complete := false
	defer func() {
		if !complete {
			upload.Remove()
		}
	}()
	r.Body = http.MaxBytesReader(w, r.Body, MaxTransferUpload+(1<<20))
	reader, err := r.MultipartReader()
	if err != nil {
		shared.Fail(http.StatusBadRequest, shared.MsgImportFileRequired)
	}
	parts := 0
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
		if parts > 4 {
			shared.Fail(http.StatusBadRequest, shared.MsgImportFieldsInvalid)
		}
		if part.FileName() == "" {
			if name != "project_key" && name != "folder_key" && name != "request_id" {
				shared.Fail(http.StatusBadRequest, shared.MsgImportFieldInvalid)
			}
			if _, exists := upload.Fields[name]; exists {
				shared.Fail(http.StatusBadRequest, shared.MsgImportFieldDuplicate)
			}
			value, readErr := io.ReadAll(io.LimitReader(part, 257))
			if readErr != nil {
				uploadReadError(readErr)
			}
			if len(value) > 256 {
				shared.Fail(http.StatusBadRequest, shared.MsgImportFieldTooLong)
			}
			upload.Fields[name] = string(value)
		} else {
			if name != "file" || upload.Path != "" {
				shared.Fail(http.StatusBadRequest, shared.MsgImportSingleFile)
			}
			filename := part.FileName()
			lower := strings.ToLower(filename)
			maximum := MaxTransferUpload
			if strings.HasSuffix(lower, ".md") {
				maximum = 2 << 20
			} else if !strings.HasSuffix(lower, ".voex") {
				shared.Fail(http.StatusBadRequest, shared.MsgImportExtensionInvalid)
			}
			file, path := s.NewTransferFile()
			upload.Path, upload.Name, upload.MIME = path, filename, part.Header.Get("Content-Type")
			upload.Size, err = io.Copy(file, io.LimitReader(part, maximum+1))
			closeErr := file.Close()
			if err != nil {
				uploadReadError(err)
			}
			shared.Must(closeErr)
			if upload.Size > maximum {
				shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgImportSizeLimit)
			}
		}
		if err := part.Close(); err != nil {
			uploadReadError(err)
		}
	}
	if upload.Path == "" {
		shared.Fail(http.StatusBadRequest, shared.MsgImportFileMissing)
	}
	complete = true
	return upload
}
