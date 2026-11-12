package service

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"gorm.io/gorm"
	"voex-server/internal/filestore"
	"voex-server/internal/identity"
	"voex-server/internal/repository"
	"voex-server/internal/shared"
)

const (
	transferTTL                  = 15 * time.Minute
	transferMaxEntries           = 2000
	transferMaxAssets            = 1900
	transferMaxExpanded   uint64 = 1 << 30
	transferMaxAttachment uint64 = 300 << 20
	transferMaxDocument   uint64 = 16 << 20
)

type TransferWarning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Name    string `json:"name,omitempty"`
	Source  string `json:"source,omitempty"`
}

type transferAsset struct {
	Hash    string `json:"hash"`
	Path    string `json:"path"`
	Name    string `json:"name"`
	MIME    string `json:"mime"`
	Size    int64  `json:"size"`
	Missing bool   `json:"missing,omitempty"`
}

type transferManifest struct {
	Format        string          `json:"format"`
	FormatVersion int             `json:"format_version"`
	SchemaVersion string          `json:"schema_version"`
	Title         string          `json:"title"`
	Assets        []transferAsset `json:"assets"`
}

type transferReference struct {
	Kind        string `json:"kind"`
	Hash        string `json:"hash"`
	Source      string `json:"source"`
	DocumentKey string `json:"document_key"`
	Name        string `json:"name"`
	MIME        string `json:"mime"`
}

type transferCodecResult struct {
	Document      json.RawMessage     `json:"document"`
	Markdown      string              `json:"markdown"`
	StateBase64   string              `json:"state_base64"`
	SchemaVersion string              `json:"schema_version"`
	References    []transferReference `json:"references"`
	Warnings      []TransferWarning   `json:"warnings"`
}

type documentExport struct {
	UserID  string
	FileKey string
	Name    string
	Path    string
	Expires time.Time
}

type documentTransferRuntime struct {
	mu      sync.Mutex
	exports map[string]*documentExport
	slots   chan struct{}
}

func (s *Service) transferRuntime() *documentTransferRuntime {
	s.transferOnce.Do(func() {
		s.transfers = &documentTransferRuntime{
			exports: map[string]*documentExport{},
			slots:   make(chan struct{}, 2),
		}
	})
	return s.transfers
}

func (s *Service) transferSlot(ctx context.Context) func() {
	runtime := s.transferRuntime()
	if ctx.Err() != nil {
		shared.Fail(http.StatusRequestTimeout, shared.MsgOperationCanceled)
	}
	select {
	case runtime.slots <- struct{}{}:
		return func() { <-runtime.slots }
	default:
		shared.Fail(http.StatusTooManyRequests, shared.MsgTransferBusy)
	}
	return nil
}

func (s *Service) transferCodec(ctx context.Context, input any) transferCodecResult {
	if s.collab == nil || !s.collabSchema {
		shared.Fail(http.StatusServiceUnavailable, shared.MsgConversionDisabled)
	}
	data, err := json.Marshal(input)
	shared.Must(err)
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		strings.TrimRight(s.collab.config.URL, "/")+"/internal/collab/transfer",
		bytes.NewReader(data),
	)
	shared.Must(err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Collab-Secret", string(s.collab.secret))
	res, err := s.collab.client.Do(req)
	if err != nil {
		shared.NetworkFailure("document conversion", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, (40<<20)+1))
	if err != nil {
		shared.NetworkFailure("read document conversion response", err)
	}
	if len(raw) > 40<<20 {
		shared.NetworkFailure(
			"read document conversion response",
			errors.New("response exceeds 40 MiB"),
		)
	}
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		// Preserve actionable conversion states without forwarding remote diagnostic text.
		// 保留可供调用方采取行动的转换状态，不转发远程诊断文本。
		switch res.StatusCode {
		case http.StatusBadRequest:
			shared.Fail(http.StatusBadRequest, shared.MsgConversionDocumentInvalid)
		case http.StatusConflict:
			shared.Fail(http.StatusConflict, shared.MsgConversionSchemaConflict)
		case http.StatusRequestEntityTooLarge:
			shared.Fail(http.StatusRequestEntityTooLarge, shared.SizeLimitMessage("文档内容"))
		default:
			shared.UpstreamFailure("document conversion", res.StatusCode)
		}
	}
	var result transferCodecResult
	if json.Unmarshal(raw, &result) != nil || result.SchemaVersion != collaborationSchema {
		shared.Fail(http.StatusServiceUnavailable, shared.MsgConversionResultInvalid)
	}
	return result
}

func uniqueTransferWarnings(warnings []TransferWarning) []TransferWarning {
	result := make([]TransferWarning, 0, len(warnings))
	seen := map[string]bool{}
	for _, warning := range warnings {
		key := warning.Code + "\x00" + warning.Name + "\x00" + warning.Source
		if !seen[key] {
			seen[key] = true
			result = append(result, warning)
		}
	}
	return result
}

func exportBaseName(name string) string {
	var builder strings.Builder
	for _, r := range strings.TrimSpace(name) {
		if unicode.IsControl(r) || strings.ContainsRune("\\/:*?\"<>|", r) {
			builder.WriteByte('_')
		} else {
			builder.WriteRune(r)
		}
	}
	value := strings.Trim(builder.String(), " .")
	if value == "" {
		value = "document"
	}
	runes := []rune(value)
	for len(string(runes)) > 120 || len(runes) > 100 {
		runes = runes[:len(runes)-1]
	}
	value = string(runes)
	reserved := strings.ToUpper(strings.SplitN(value, ".", 2)[0])
	if reserved == "CON" || reserved == "PRN" || reserved == "AUX" || reserved == "NUL" ||
		(len(reserved) == 4 &&
			(strings.HasPrefix(reserved, "COM") ||
				strings.HasPrefix(reserved, "LPT")) &&
			reserved[3] >= '1' &&
			reserved[3] <= '9') {
		value = "_" + value
	}
	return value
}

func transferAssetPath(name, hash, format string) string {
	clean := exportBaseName(name)
	ext := path.Ext(clean)
	if len(ext) > 16 || strings.ContainsAny(ext, " #()%") {
		ext = ""
	}
	if format == "voex" {
		return "assets/" + hash + ext
	}
	stem := strings.TrimSuffix(clean, ext)
	return "assets/" + stem + "-" + hash + ext
}

func missingAssetWarning(asset transferAsset, reason string) TransferWarning {
	return TransferWarning{
		Code:    "missing_attachment",
		Name:    asset.Name,
		Source:  asset.Hash,
		Message: reason,
	}
}

// ExportDocument snapshots metadata, body, Yjs state and attachment records together.
// File I/O and conversion run after that short transaction, outside workspace locks.
// ExportDocument 在同一快照中读取元数据、正文、Yjs 状态和附件记录。
// 文件 I/O 和转换在该短事务结束后执行，不占用工作区锁。
func (s *Service) ExportDocument(
	ctx context.Context,
	key, format string,
	preserveStyles bool,
) shared.Row {
	userID := shared.String(identity.User(ctx)["id"])
	if format != "voex" && format != "markdown" {
		shared.Fail(http.StatusBadRequest, shared.MsgExportFormatInvalid)
	}
	release := s.transferSlot(ctx)
	defer release()
	var document shared.Row
	var state *repository.CollaborationState
	var rows []shared.Row
	s.tx(ctx, false, func(db *gorm.DB) any {
		document = s.FindDocument(db, ctx, key, "write", true)
		state = repository.LoadCollaboration(db, document["id"])
		rows = repository.TransferAttachments(db, key)
		return nil
	})
	runtime := s.transferRuntime()
	exportID := shared.RandomToken(24)
	entry := &documentExport{UserID: userID, FileKey: key}
	runtime.mu.Lock()
	userCount := 0
	for _, item := range runtime.exports {
		if item.UserID == userID {
			userCount++
		}
	}
	if userCount >= 2 || len(runtime.exports) >= 8 {
		runtime.mu.Unlock()
		shared.Fail(http.StatusTooManyRequests, shared.MsgExportPending)
	}
	runtime.exports[exportID] = entry
	runtime.mu.Unlock()
	published := false
	var archivePath string
	defer func() {
		if !published {
			runtime.mu.Lock()
			delete(runtime.exports, exportID)
			runtime.mu.Unlock()
			if archivePath != "" {
				_ = os.Remove(archivePath)
			}
		}
	}()
	input := shared.Row{"action": "decode", "schema_version": collaborationSchema}
	if state != nil {
		input["state_base64"] = base64.StdEncoding.EncodeToString(state.State)
		input["schema_version"] = state.SchemaVersion
	} else {
		input["markdown"] = shared.String(document["file_content"])
	}
	decoded := s.transferCodec(ctx, input)
	warnings := decoded.Warnings
	linked := map[string]shared.Row{}
	for _, row := range rows {
		hash := shared.String(row["hash"])
		if linked[hash] == nil {
			linked[hash] = row
		}
	}
	assets := make([]transferAsset, 0)
	paths := map[string]string{}
	add := func(hash, name, mime string, size int64, missing bool) {
		if !attachmentHashPattern.MatchString(hash) {
			shared.Fail(http.StatusBadRequest, shared.MsgExportAttachmentInvalid)
		}
		if name == "" {
			name = "attachment"
		}
		if mime == "" {
			mime = "application/octet-stream"
		}
		assetPath := paths[hash]
		if assetPath == "" {
			assetPath = transferAssetPath(name, hash, format)
			paths[hash] = assetPath
		}
		assets = append(
			assets,
			transferAsset{
				Hash:    hash,
				Path:    assetPath,
				Name:    name,
				MIME:    mime,
				Size:    size,
				Missing: missing,
			},
		)
	}
	if format == "voex" {
		for _, row := range rows {
			add(
				shared.String(row["hash"]),
				shared.String(row["name"]),
				shared.String(row["mime"]),
				shared.Int64(row["size"]),
				false,
			)
		}
	}
	for _, ref := range decoded.References {
		if _, exists := paths[ref.Hash]; exists {
			continue
		}
		if row := linked[ref.Hash]; row != nil {
			add(
				ref.Hash,
				shared.String(row["name"]),
				shared.String(row["mime"]),
				shared.Int64(row["size"]),
				false,
			)
		} else {
			add(ref.Hash, ref.Name, ref.MIME, 0, true)
		}
	}
	if len(assets) > transferMaxAssets {
		shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgExportAttachmentCountLimit)
	}
	checked := map[string]bool{}
	var expanded uint64
	for index := range assets {
		asset := &assets[index]
		if previous, exists := checked[asset.Hash]; exists {
			asset.Missing = previous
			continue
		}
		if !asset.Missing {
			file, info, err := s.Files.OpenTransferAttachment(asset.Hash)
			if errors.Is(err, fs.ErrNotExist) {
				asset.Missing = true
			} else if err != nil {
				shared.Must(err)
			} else {
				_ = file.Close()
				if info.Size() < 0 || uint64(info.Size()) > transferMaxAttachment ||
					uint64(info.Size()) > transferMaxExpanded-expanded {
					shared.Fail(
						http.StatusRequestEntityTooLarge,
						shared.MsgExportAttachmentSizeLimit,
					)
				}
				expanded += uint64(info.Size())
				asset.Size = info.Size()
			}
		}
		checked[asset.Hash] = asset.Missing
	}
	for index := range assets {
		asset := &assets[index]
		asset.Missing = checked[asset.Hash]
		if asset.Missing {
			warnings = append(warnings, missingAssetWarning(*asset, "附件缺失，正文引用已保留"))
		}
	}
	converted := s.transferCodec(
		ctx,
		shared.Row{
			"action":          "export",
			"document":        decoded.Document,
			"schema_version":  decoded.SchemaVersion,
			"format":          format,
			"preserve_styles": preserveStyles,
			"assets":          assets,
		},
	)
	warnings = append(warnings, converted.Warnings...)
	archive, filename := s.Files.NewTransferFile()
	archivePath = filename
	defer archive.Close()
	bounded := &transferLimitedWriter{writer: archive, remaining: filestore.MaxTransferUpload}
	writer := zip.NewWriter(bounded)
	expanded = 0
	archiveName := ""
	written := map[string]bool{}
	for index := range assets {
		asset := &assets[index]
		if asset.Missing || written[asset.Hash] {
			continue
		}
		written[asset.Hash] = true
		file, info, err := s.Files.OpenTransferAttachment(asset.Hash)
		if errors.Is(err, fs.ErrNotExist) {
			for other := range assets {
				if assets[other].Hash == asset.Hash {
					assets[other].Missing = true
					warnings = append(warnings, missingAssetWarning(assets[other], "附件缺失，正文引用已保留"))
				}
			}
			continue
		}
		if err != nil {
			shared.Must(err)
		}
		if info.Size() < 0 || uint64(info.Size()) > transferMaxAttachment {
			_ = file.Close()
			shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgExportAttachmentSizeLimit)
		}
		header := &zip.FileHeader{Name: asset.Path, Method: zip.Deflate}
		header.SetMode(0600)
		destination, writeErr := writer.CreateHeader(header)
		if writeErr != nil {
			_ = file.Close()
			shared.Must(writeErr)
		}
		hash := sha256.New()
		copied, copyErr := io.Copy(
			io.MultiWriter(destination, hash),
			&transferContextReader{
				ctx:    ctx,
				reader: io.LimitReader(file, int64(transferMaxAttachment)+1),
			},
		)
		_ = file.Close()
		if copyErr != nil {
			shared.Must(copyErr)
		}
		if uint64(copied) > transferMaxAttachment ||
			hex.EncodeToString(hash.Sum(nil)) != asset.Hash {
			shared.Fail(http.StatusConflict, shared.MsgExportAttachmentCorrupt)
		}
		if uint64(copied) > transferMaxExpanded-expanded {
			shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgExportExpandedTooLarge)
		}
		expanded += uint64(copied)
		for other := range assets {
			if assets[other].Hash == asset.Hash {
				assets[other].Size = copied
			}
		}
	}
	base := exportBaseName(shared.String(document["file_name"]))
	if format == "voex" {
		if len(converted.Document) == 0 || uint64(len(converted.Document)) > transferMaxDocument {
			shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgExportDocumentTooLarge)
		}
		manifest := transferManifest{
			Format:        "voex",
			FormatVersion: 1,
			SchemaVersion: converted.SchemaVersion,
			Title:         shared.String(document["file_name"]),
			Assets:        assets,
		}
		data, err := json.MarshalIndent(manifest, "", "  ")
		shared.Must(err)
		if len(data) > 2<<20 ||
			uint64(len(data)+len(converted.Document)) > transferMaxExpanded-expanded {
			shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgExportManifestTooLarge)
		}
		expanded += uint64(len(data) + len(converted.Document))
		writeTransferEntry(writer, "document.json", converted.Document)
		writeTransferEntry(writer, "manifest.json", data)
		archiveName = base + ".voex"
	} else {
		if uint64(len(converted.Markdown)) > transferMaxExpanded-expanded {
			shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgExportExpandedTooLarge)
		}
		expanded += uint64(len(converted.Markdown))
		writeTransferEntry(writer, base+".md", []byte(converted.Markdown))
		archiveName = base + ".zip"
	}
	warnings = uniqueTransferWarnings(warnings)
	if format == "markdown" && len(warnings) > 0 {
		data, err := json.MarshalIndent(shared.Row{"warnings": warnings}, "", "  ")
		shared.Must(err)
		if uint64(len(data)) > transferMaxExpanded-expanded {
			shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgExportExpandedTooLarge)
		}
		writeTransferEntry(writer, "export-report.json", data)
	}
	if err := writer.Close(); err != nil {
		shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgExportArchiveFailed)
	}
	shared.Must(archive.Sync())
	shared.Must(archive.Close())
	if ctx.Err() != nil {
		shared.Fail(http.StatusRequestTimeout, shared.MsgExportCanceled)
	}
	// Permission changes during compression cannot publish a downloadable artifact.
	// 压缩期间若权限发生变化，不得发布可供下载的产物。
	s.tx(
		ctx,
		false,
		func(db *gorm.DB) any { s.FindDocument(db, ctx, key, "write", false); return nil },
	)
	runtime.mu.Lock()
	entry.Name = archiveName
	entry.Path = archivePath
	entry.Expires = time.Now().Add(transferTTL)
	runtime.mu.Unlock()
	time.AfterFunc(transferTTL, func() {
		runtime.mu.Lock()
		delete(runtime.exports, exportID)
		runtime.mu.Unlock()
		_ = os.Remove(archivePath)
	})
	published = true
	return shared.Row{
		"export_id":    exportID,
		"file_name":    archiveName,
		"download_url": "/api/document-exports/" + exportID,
		"warnings":     warnings,
	}
}

// ReleaseDocumentExport is owner-only and idempotent; clients call it after receiving the blob.
// ReleaseDocumentExport 仅允许所有者调用，且具有幂等性；客户端收到 blob 后调用。
func (s *Service) ReleaseDocumentExport(ctx context.Context, id string) {
	userID := shared.String(identity.User(ctx)["id"])
	runtime := s.transferRuntime()
	runtime.mu.Lock()
	entry := runtime.exports[id]
	if entry == nil {
		runtime.mu.Unlock()
		return
	}
	if entry.UserID != userID {
		runtime.mu.Unlock()
		shared.Fail(http.StatusNotFound, shared.MsgExportNotFound)
	}
	if entry.Path == "" {
		runtime.mu.Unlock()
		shared.Fail(http.StatusConflict, shared.MsgExportNotReady)
	}
	delete(runtime.exports, id)
	runtime.mu.Unlock()
	_ = os.Remove(entry.Path)
}

func (s *Service) OpenDocumentExport(ctx context.Context, id string) (*os.File, string) {
	userID := shared.String(identity.User(ctx)["id"])
	runtime := s.transferRuntime()
	runtime.mu.Lock()
	stored := runtime.exports[id]
	if stored == nil || stored.UserID != userID {
		runtime.mu.Unlock()
		shared.Fail(http.StatusNotFound, shared.MsgExportNotFound)
	}
	entry := *stored
	runtime.mu.Unlock()
	if entry.Path == "" || time.Now().After(entry.Expires) {
		shared.Fail(http.StatusGone, shared.MsgExportExpired)
	}
	s.tx(
		ctx,
		false,
		func(db *gorm.DB) any {
			s.FindDocument(db, ctx, entry.FileKey, "write", false)
			return nil

		},
	)
	file, err := os.Open(entry.Path)
	if err != nil {
		shared.Fail(http.StatusGone, shared.MsgExportExpired)
	}
	return file, entry.Name
}

type transferLimitedWriter struct {
	writer    io.Writer
	remaining int64
}

func (writer *transferLimitedWriter) Write(data []byte) (int, error) {
	if int64(len(data)) > writer.remaining {
		return 0, fmt.Errorf("archive too large")
	}
	size, err := writer.writer.Write(data)
	writer.remaining -= int64(size)
	return size, err
}

type transferContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (reader *transferContextReader) Read(data []byte) (int, error) {
	if err := reader.ctx.Err(); err != nil {
		return 0, err
	}
	return reader.reader.Read(data)
}

func writeTransferEntry(writer *zip.Writer, name string, data []byte) {
	header := &zip.FileHeader{Name: name, Method: zip.Deflate}
	header.SetMode(0600)
	destination, err := writer.CreateHeader(header)
	shared.Must(err)
	_, err = destination.Write(data)
	if err != nil {
		shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgExportArchiveTooLarge)
	}
}

func validTransferPath(name string) bool {
	if name == "" || len(name) > 1024 || !utf8.ValidString(name) || strings.HasPrefix(name, "/") ||
		strings.ContainsAny(name, "\\:\x00") {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return path.Clean(name) == name && name != "." && name != ".." &&
		!strings.HasPrefix(name, "../")
}

func readTransferJSON(file *zip.File, maximum int64, target any) {
	reader, err := file.Open()
	if err != nil {
		shared.Fail(http.StatusBadRequest, shared.MsgVoexReadFailed)
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil || int64(len(data)) > maximum || !utf8.Valid(data) ||
		!shared.ValidJSONUnicode(data) {
		shared.Fail(http.StatusBadRequest, shared.MsgVoexContentInvalid)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil {
		shared.Fail(http.StatusBadRequest, shared.MsgVoexContentUnsupported)
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		shared.Fail(http.StatusBadRequest, shared.MsgVoexManifestExtraData)
	}
}

func (s *Service) readNativeTransfer(
	ctx context.Context,
	upload filestore.Upload,
) (transferManifest, json.RawMessage, map[string]filestore.Upload, []TransferWarning) {
	reader, err := zip.OpenReader(upload.Path)
	if err != nil {
		shared.Fail(http.StatusBadRequest, shared.MsgVoexArchiveInvalid)
	}
	defer reader.Close()
	if len(reader.File) > transferMaxEntries {
		shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgVoexEntryCountLimit)
	}
	entries := map[string]*zip.File{}
	caseNames := map[string]bool{}
	var total uint64
	for _, entry := range reader.File {
		name := entry.Name
		if entry.FileInfo().IsDir() {
			name = strings.TrimSuffix(name, "/")
		}
		if !validTransferPath(name) || (entry.Mode()&os.ModeSymlink) != 0 ||
			(!entry.FileInfo().IsDir() && !entry.Mode().IsRegular()) {
			shared.Fail(http.StatusBadRequest, shared.MsgVoexPathInvalid)
		}
		folded := strings.ToLower(name)
		if caseNames[folded] {
			shared.Fail(http.StatusBadRequest, shared.MsgVoexPathDuplicate)
		}
		caseNames[folded] = true
		if entry.UncompressedSize64 > transferMaxAttachment ||
			entry.UncompressedSize64 > transferMaxExpanded-total {
			shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgVoexExpandedTooLarge)
		}
		total += entry.UncompressedSize64
		if !entry.FileInfo().IsDir() {
			entries[name] = entry
		}
	}
	if entries["manifest.json"] == nil || entries["document.json"] == nil {
		shared.Fail(http.StatusBadRequest, shared.MsgVoexContentMissing)
	}
	var manifest transferManifest
	readTransferJSON(entries["manifest.json"], 2<<20, &manifest)
	if manifest.Format != "voex" || manifest.FormatVersion != 1 ||
		manifest.SchemaVersion != collaborationSchema {
		shared.Fail(http.StatusConflict, shared.MsgVoexVersionInvalid)
	}
	manifest.Title = shared.Name(manifest.Title, "文档名称")
	if len(manifest.Assets) > transferMaxAssets {
		shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgVoexAttachmentCountLimit)
	}
	if manifest.Assets == nil {
		manifest.Assets = []transferAsset{}
	}
	var document json.RawMessage
	readTransferJSON(entries["document.json"], int64(transferMaxDocument), &document)
	available := map[string]filestore.Upload{}
	complete := false
	defer func() {
		if !complete {
			for _, file := range available {
				file.Remove()
			}
		}
	}()
	warnings := []TransferWarning{}
	paths := map[string]string{}
	hashPaths := map[string]string{}
	seen := map[string]transferAsset{}
	for index := range manifest.Assets {
		asset := &manifest.Assets[index]
		if !attachmentHashPattern.MatchString(asset.Hash) || !validTransferPath(asset.Path) ||
			!strings.HasPrefix(asset.Path, "assets/") ||
			!utf8.ValidString(asset.Name) ||
			utf8.RuneCountInString(asset.Name) > 255 ||
			asset.Name == "" ||
			!assetMimePattern.MatchString(asset.MIME) ||
			len(asset.MIME) > 128 ||
			asset.Size < 0 ||
			uint64(asset.Size) > transferMaxAttachment {
			shared.Fail(http.StatusBadRequest, shared.MsgVoexAttachmentManifestInvalid)
		}
		if hash, exists := paths[asset.Path]; exists && hash != asset.Hash {
			shared.Fail(http.StatusBadRequest, shared.MsgVoexAttachmentPathConflict)
		}
		if existing, exists := hashPaths[asset.Hash]; exists && existing != asset.Path {
			shared.Fail(http.StatusBadRequest, shared.MsgVoexAttachmentPathDuplicate)
		}
		paths[asset.Path] = asset.Hash
		hashPaths[asset.Hash] = asset.Path
		if previous, exists := seen[asset.Hash]; exists {
			if previous.Size != asset.Size || previous.Missing != asset.Missing {
				shared.Fail(http.StatusBadRequest, shared.MsgVoexAttachmentMetadataConflict)
			}
			continue
		}
		seen[asset.Hash] = *asset
		entry := entries[asset.Path]
		if entry == nil {
			for other := range manifest.Assets {
				if manifest.Assets[other].Hash == asset.Hash {
					manifest.Assets[other].Missing = true
				}
			}
			// Keep original metadata for duplicate consistency checks even when a payload is
			// absent.
			// 即使缺少载荷，也保留原始元数据，用于重复请求的一致性检查。
			seen[asset.Hash] = *asset
			continue
		}
		if asset.Missing {
			shared.Fail(http.StatusBadRequest, shared.MsgVoexMissingAttachmentPresent)
		}
		if entry.UncompressedSize64 != uint64(asset.Size) {
			shared.Fail(http.StatusBadRequest, shared.MsgVoexAttachmentSizeMismatch)
		}
		source, err := entry.Open()
		if err != nil {
			shared.Fail(http.StatusBadRequest, shared.MsgVoexAttachmentReadFailed)
		}
		staged, filename := s.Files.NewTransferFile()
		temporary := filestore.Upload{
			Path: filename,
			Name: asset.Name,
			MIME: asset.MIME,
			Size: asset.Size,
		}
		available[asset.Hash] = temporary
		hash := sha256.New()
		count, copyErr := io.Copy(
			io.MultiWriter(staged, hash),
			&transferContextReader{
				ctx:    ctx,
				reader: io.LimitReader(source, int64(transferMaxAttachment)+1),
			},
		)
		_ = source.Close()
		closeErr := staged.Close()
		if copyErr != nil || closeErr != nil || count != asset.Size ||
			hex.EncodeToString(hash.Sum(nil)) != asset.Hash {
			shared.Fail(http.StatusBadRequest, shared.MsgVoexAttachmentCorrupt)
		}
	}
	for name := range entries {
		if name != "manifest.json" && name != "document.json" {
			if _, exists := paths[name]; !exists {
				shared.Fail(http.StatusBadRequest, shared.MsgVoexUnexpectedEntry)
			}
		}
	}
	for _, asset := range manifest.Assets {
		if asset.Missing {
			warnings = append(warnings, missingAssetWarning(asset, "附件缺失，已保留正文和可用附件"))
		}
	}
	complete = true
	return manifest, document, available, warnings
}

// Acquire capacity before accepting a potentially large multipart body.
// 接收可能很大的 multipart 请求体前，先获取处理容量。
func (s *Service) ImportDocumentRequest(w http.ResponseWriter, r *http.Request) shared.Row {
	identity.User(r.Context())
	release := s.transferSlot(r.Context())
	defer release()
	upload := s.Files.ReadDocumentUpload(w, r)
	return s.importDocument(r.Context(), upload)
}

func (s *Service) importDocument(ctx context.Context, upload filestore.Upload) shared.Row {
	defer upload.Remove()
	user := identity.User(ctx)
	userID := shared.String(user["id"])
	projectKey := shared.Key(upload.Fields["project_key"], "目标项目")
	folderKey := ""
	if value := shared.String(upload.Fields["folder_key"]); value != "" {
		folderKey = shared.Key(value, "目标文件夹")
	}
	requestID := shared.String(upload.Fields["request_id"])
	if len(requestID) < 16 || len(requestID) > 80 ||
		strings.IndexFunc(
			requestID,
			func(r rune) bool {
				return !unicode.IsLetter(r) &&
					!unicode.IsDigit(r) &&
					r != '-' &&
					r != '_'

			},
		) >= 0 {
		shared.Fail(http.StatusBadRequest, shared.MsgImportRequestInvalid)
	}
	var project, folder shared.Row
	s.tx(ctx, false, func(db *gorm.DB) any {
		project, folder = s.workspaceDocumentLocation(db, ctx, projectKey, folderKey, "")
		return nil
	})
	digest := filestore.ComputeHash(upload.Path)
	// Identical retries survive process restarts without importing a second document.
	// 相同请求在进程重启后仍可安全重试，不会重复导入文档。
	identityJSON, err := json.Marshal(
		[]string{
			userID,
			requestID,
			digest,
			shared.String(project["project_key"]),
			shared.String(folder["folder_key"]),
		},
	)
	shared.Must(err)
	key := shared.Digest(string(identityJSON))
	warnings := []TransferWarning{}
	assets := []transferAsset{}
	available := map[string]filestore.Upload{}
	defer func() {
		for _, file := range available {
			file.Remove()
		}
	}()
	title := ""
	request := shared.Row{
		"action":         "import",
		"file_key":       key,
		"schema_version": collaborationSchema,
	}
	lower := strings.ToLower(upload.Name)
	switch {
	case strings.HasSuffix(lower, ".md"):
		if upload.Size > 2<<20 {
			shared.Fail(
				http.StatusRequestEntityTooLarge,
				shared.MaxSizeMessage("Markdown 正文", 2, "MiB"),
			)
		}
		content, err := os.ReadFile(upload.Path)
		shared.Must(err)
		if !utf8.Valid(content) {
			shared.Fail(http.StatusBadRequest, shared.MsgMarkdownEncodingInvalid)
		}
		title = strings.TrimSpace(strings.TrimSuffix(upload.Name, path.Ext(upload.Name)))
		if title == "" {
			title = "document"
		}
		if !utf8.ValidString(title) {
			shared.Fail(http.StatusBadRequest, shared.MsgFilenameEncodingInvalid)
		}
		title = shared.Name(title, "文档名称")
		request["markdown"] = strings.TrimPrefix(string(content), "\uFEFF")
	case strings.HasSuffix(lower, ".voex"):
		manifest, document, files, nativeWarnings := s.readNativeTransfer(ctx, upload)
		title, assets, available, warnings = manifest.Title, manifest.Assets, files, nativeWarnings
		request["document"] = document
		request["assets"] = assets
		request["schema_version"] = manifest.SchemaVersion
	default:
		shared.Fail(http.StatusBadRequest, shared.MsgImportExtensionInvalid)
	}
	converted := s.transferCodec(ctx, request)
	warnings = append(warnings, converted.Warnings...)
	state, err := base64.StdEncoding.DecodeString(converted.StateBase64)
	if err != nil || len(state) == 0 || len(state) > 16<<20 || len(converted.Markdown) > 2<<20 {
		shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgImportDocumentTooLarge)
	}
	for hash, file := range available {
		s.Files.SaveAttachment(ctx, file, hash)
	}
	result := s.tx(ctx, true, func(db *gorm.DB) any {
		currentProject, currentFolder := s.workspaceDocumentLocation(
			db,
			ctx,
			projectKey,
			folderKey,
			"",
		)
		replayed := false
		if existing := repository.TransferDocumentByKey(db, key); existing != nil {
			if existing["deleted_at"] != nil {
				shared.Fail(http.StatusConflict, shared.MsgImportDocumentDeleted)
			}
			if shared.String(existing["creator_id"]) != userID ||
				shared.String(existing["folder_id"]) != shared.String(currentFolder["id"]) {
				shared.Fail(http.StatusConflict, shared.MsgImportDocumentMoved)
			}
			s.FindDocument(db, ctx, key, "write", false)
			title = shared.String(existing["file_name"])
			replayed = true
		} else {
			repository.WorkspaceInsertDocument(db, key, title, currentFolder["id"], userID)
			row := repository.DocumentByKey(db, key, false)
			repository.WorkspaceUpdateDocument(
				db,
				key,
				shared.Row{
					"file_content": converted.Markdown,
				},
				false,
				userID,
			)
			repository.InsertCollaboration(db, row["id"], state, converted.SchemaVersion)
			for _, asset := range assets {
				if _, present := available[asset.Hash]; !present {
					continue
				}
				repository.CreateAttachment(
					db,
					shared.Row{
						"file_key":   key,
						"hash":       asset.Hash,
						"name":       asset.Name,
						"mime":       asset.MIME,
						"size":       asset.Size,
						"creator_id": userID,
						"privileges": `{"mode":"inherit"}`,
					},
				)
			}
			s.historySnapshot(db, row["id"], converted.Markdown, 1, userID, false, "auto", "")
			repository.CollaborationEvent(db, "document", key)
		}
		return shared.Row{
			"file_key":     key,
			"file_name":    title,
			"project_key":  currentProject["project_key"],
			"folder_key":   currentFolder["folder_key"],
			"project_name": currentProject["name"],
			"folder_path": []any{
				currentFolder["name"],
			},
			"creator":  shared.Creator(user),
			"replayed": replayed,
		}
	}).(shared.Row)
	return shared.Row{"document": result, "warnings": uniqueTransferWarnings(warnings)}
}
