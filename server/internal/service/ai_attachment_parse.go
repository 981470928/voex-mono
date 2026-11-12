package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"
	"voex-server/internal/shared"
)

func parseAIAttachmentText(ctx context.Context, name string, data []byte) string {
	extension := strings.ToLower(filepath.Ext(name))
	var text string
	switch extension {
	case ".md", ".txt":
		text = aiDecodeText(data)
	case ".doc", ".ppt", ".xls":
		text = aiLegacyOfficeText(ctx, extension, data)
	case ".docx", ".pptx", ".xlsx":
		text = aiOpenXMLText(extension, data)
	default:
		shared.Fail(http.StatusBadRequest, shared.MsgFileTypeUnsupported)
	}
	return validatedAIText(text)
}

func aiDecodeText(data []byte) string {
	if bytes.HasPrefix(data, []byte{0xff, 0xfe}) || bytes.HasPrefix(data, []byte{0xfe, 0xff}) {
		if (len(data)-2)%2 != 0 {
			shared.Fail(http.StatusBadRequest, shared.MsgUTF16Invalid)
		}
		words := make([]uint16, (len(data)-2)/2)
		var order binary.ByteOrder = binary.LittleEndian
		if data[0] == 0xfe {
			order = binary.BigEndian
		}
		for index := range words {
			words[index] = order.Uint16(data[2+index*2:])
		}
		for index := 0; index < len(words); index++ {
			word := words[index]
			if word >= 0xd800 && word <= 0xdbff {
				if index+1 >= len(words) || words[index+1] < 0xdc00 || words[index+1] > 0xdfff {
					shared.Fail(http.StatusBadRequest, shared.MsgUTF16Invalid)
				}
				index++
			} else if word >= 0xdc00 && word <= 0xdfff {
				shared.Fail(http.StatusBadRequest, shared.MsgUTF16Invalid)
			}
		}
		return string(utf16.Decode(words))
	}
	if !utf8.Valid(data) {
		shared.Fail(http.StatusBadRequest, shared.MsgTextEncodingInvalid)
	}
	return string(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}))
}

type aiLimitedOutput struct {
	buffer   bytes.Buffer
	maximum  int
	overflow bool
}

func (output *aiLimitedOutput) Write(data []byte) (int, error) {
	remaining := output.maximum - output.buffer.Len()
	if len(data) > remaining {
		if remaining > 0 {
			_, _ = output.buffer.Write(data[:remaining])
		}
		output.overflow = true
		return 0, errors.New("output exceeds limit")
	}
	return output.buffer.Write(data)
}

func aiLegacyOfficeText(ctx context.Context, extension string, data []byte) string {
	if !bytes.HasPrefix(data, []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}) {
		shared.Fail(http.StatusBadRequest, shared.MsgOfficeFileInvalid)
	}
	commandName := map[string]string{
		".doc": "catdoc",
		".ppt": "catppt",
		".xls": "xls2csv",
	}[extension]
	executable, err := exec.LookPath(commandName)
	if err != nil {
		shared.Fail(http.StatusServiceUnavailable, shared.MsgOfficeParserUnavailable)
	}
	file, err := os.CreateTemp("", "voex-ai-office-*"+extension)
	shared.Must(err)
	filename := file.Name()
	defer os.Remove(filename)
	// CreateTemp creates files with 0600 permissions. No original file is retained after this
	// request.
	// CreateTemp 以 0600 权限创建文件；请求结束后不保留原始文件。
	if _, err = file.Write(data); err != nil {
		_ = file.Close()
		shared.Must(err)
	}
	shared.Must(file.Close())
	operation, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	args := []string{"-d", "utf-8"}
	if extension == ".doc" {
		args = append(args, "-w", "-f", "ascii")
	}
	if extension == ".ppt" {
		args = append(args, "-b", "\n")
	}
	if extension == ".xls" {
		args = append(args, "-q", "3")
	}
	args = append(args, filename)
	command := exec.CommandContext(operation, executable, args...)
	output := &aiLimitedOutput{maximum: aiAttachmentTextSize + 1}
	diagnostics := &aiLimitedOutput{maximum: 4096}
	command.Stdout, command.Stderr = output, diagnostics
	err = command.Run()
	if ctx.Err() != nil {
		shared.Must(ctx.Err())
	}
	if operation.Err() != nil {
		shared.Fail(http.StatusBadRequest, shared.MsgOfficeParseTimeout)
	}
	if output.overflow {
		shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgOfficeTextTooLarge)
	}
	if err != nil {
		shared.Fail(http.StatusBadRequest, shared.MsgOfficeReadFailed)
	}
	// Legacy tools can report partial extraction, unknown encodings or encryption
	// on stderr while returning zero. Never silently submit that partial text.
	// 旧版工具可能在退出码为零时，仍通过 stderr 报告提取不完整、编码未知或文件加密。
	// 绝不能在未提示的情况下提交这类不完整文本。
	if strings.TrimSpace(diagnostics.buffer.String()) != "" {
		shared.Fail(http.StatusBadRequest, shared.MsgOfficeContentUnsupported)
	}
	return strings.ReplaceAll(output.buffer.String(), "\x00", "")
}

type aiXMLArchive struct {
	files map[string]*zip.File
}

func newAIXMLArchive(data []byte) aiXMLArchive {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(archive.File) > 2048 {
		shared.Fail(http.StatusBadRequest, shared.MsgOfficeArchiveInvalid)
	}
	result := aiXMLArchive{files: map[string]*zip.File{}}
	var size uint64
	for _, file := range archive.File {
		if file.FileInfo().IsDir() {
			continue
		}
		if file.Flags&1 != 0 {
			shared.Fail(http.StatusBadRequest, shared.MsgOfficeEncrypted)
		}
		clean := path.Clean(file.Name)
		if clean != file.Name || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") ||
			strings.Contains(clean, "\\") || result.files[clean] != nil {
			shared.Fail(http.StatusBadRequest, shared.MsgOfficeStructureInvalid)
		}
		if file.UncompressedSize64 > 32*1024*1024 || size > 32*1024*1024-file.UncompressedSize64 {
			shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgOfficeExpandedTooLarge)
		}
		size += file.UncompressedSize64
		result.files[clean] = file
	}
	return result
}

func (archive aiXMLArchive) read(name string, required bool) []byte {
	file := archive.files[name]
	if file == nil {
		if required {
			shared.Fail(http.StatusBadRequest, shared.MsgOfficeContentMissing)
		}
		return nil
	}
	reader, err := file.Open()
	if err != nil {
		shared.Fail(http.StatusBadRequest, shared.MsgOfficeCorrupt)
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, 32*1024*1024+1))
	if err != nil || len(data) > 32*1024*1024 {
		shared.Fail(http.StatusBadRequest, shared.MsgOfficeContentTooLarge)
	}
	return data
}

func aiXMLDecoder(data []byte) *xml.Decoder {
	return xml.NewDecoder(bytes.NewReader(data))
}

func aiExtractParagraphText(data []byte, expectedRoot string) string {
	decoder := aiXMLDecoder(data)
	var output strings.Builder
	capture := false
	root := false
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			shared.Fail(http.StatusBadRequest, shared.MsgOfficeXMLInvalid)
		}
		switch value := token.(type) {
		case xml.StartElement:
			if !root {
				if value.Name.Local != expectedRoot {
					shared.Fail(http.StatusBadRequest, shared.MsgOfficeExtensionMismatch)
				}
				root = true
			}
			switch value.Name.Local {
			case "t":
				capture = true
			case "tab":
				output.WriteByte('\t')
			case "br", "cr":
				output.WriteByte('\n')
			}
		case xml.EndElement:
			if value.Name.Local == "t" {
				capture = false
			}
			if value.Name.Local == "p" {
				output.WriteByte('\n')
			}
		case xml.CharData:
			if capture {
				output.Write(value)
			}
		}
		if output.Len() > aiAttachmentTextSize {
			shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgOfficeTextTooLarge)
		}
	}
	if !root {
		shared.Fail(http.StatusBadRequest, shared.MsgOfficeTextMissing)
	}
	return output.String()
}

type aiRelationship struct {
	ID     string `xml:"Id,attr"`
	Target string `xml:"Target,attr"`
	Type   string `xml:"Type,attr"`
	Mode   string `xml:"TargetMode,attr"`
}

func (archive aiXMLArchive) relationships(name, base, requiredType string) map[string]string {
	data := archive.read(name, true)
	var document struct {
		Relationships []aiRelationship `xml:"Relationship"`
	}
	if xml.Unmarshal(data, &document) != nil {
		shared.Fail(http.StatusBadRequest, shared.MsgOfficeRelationshipInvalid)
	}
	result := map[string]string{}
	for _, relationship := range document.Relationships {
		if relationship.Mode == "External" ||
			!strings.HasSuffix(relationship.Type, "/"+requiredType) {
			continue
		}
		target := path.Clean(path.Join(base, relationship.Target))
		if strings.HasPrefix(relationship.Target, "/") {
			target = strings.TrimPrefix(path.Clean(relationship.Target), "/")
		}
		if !strings.HasPrefix(target, base+"/") || strings.Contains(relationship.Target, "\\") ||
			strings.Contains(target, "../") {
			shared.Fail(http.StatusBadRequest, shared.MsgOfficeRelationshipPathInvalid)
		}
		result[relationship.ID] = target
	}
	return result
}

func aiRelationshipID(attributes []xml.Attr) string {
	for _, attribute := range attributes {
		if attribute.Name.Local == "id" && attribute.Name.Space != "" {
			return attribute.Value
		}
	}
	return ""
}

func aiOpenXMLText(extension string, data []byte) string {
	archive := newAIXMLArchive(data)
	switch extension {
	case ".docx":
		return aiExtractParagraphText(archive.read("word/document.xml", true), "document")
	case ".pptx":
		relationships := archive.relationships("ppt/_rels/presentation.xml.rels", "ppt", "slide")
		decoder := aiXMLDecoder(archive.read("ppt/presentation.xml", true))
		var output strings.Builder
		count := 0
		hasText := false
		for {
			token, err := decoder.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				shared.Fail(http.StatusBadRequest, shared.MsgPPTXDirectoryInvalid)
			}
			element, ok := token.(xml.StartElement)
			if !ok || element.Name.Local != "sldId" {
				continue
			}
			name := relationships[aiRelationshipID(element.Attr)]
			if name == "" {
				shared.Fail(http.StatusBadRequest, shared.MsgPPTXSlidesMissing)
			}
			count++
			text := aiExtractParagraphText(archive.read(name, true), "sld")
			if strings.TrimSpace(text) != "" {
				hasText = true
			}
			fmt.Fprintf(&output, "幻灯片 %d\n%s\n", count, text)
			if output.Len() > aiAttachmentTextSize {
				shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgOfficeTextTooLarge)
			}
		}
		if count == 0 || !hasText {
			shared.Fail(http.StatusBadRequest, shared.MsgPPTXTextMissing)
		}
		return output.String()
	case ".xlsx":
		return archive.spreadsheetText()
	}
	shared.Fail(http.StatusBadRequest, shared.MsgOfficeTypeUnsupported)
	return ""
}

type aiInlineString struct {
	Text string `xml:"t"`
	Runs []struct {
		Text string `xml:"t"`
	} `xml:"r"`
}

func (value aiInlineString) text() string {
	var output strings.Builder
	output.WriteString(value.Text)
	for _, run := range value.Runs {
		output.WriteString(run.Text)
	}
	return output.String()
}

type aiSpreadsheetCell struct {
	Reference string         `xml:"r,attr"`
	Type      string         `xml:"t,attr"`
	Value     string         `xml:"v"`
	Formula   string         `xml:"f"`
	Inline    aiInlineString `xml:"is"`
}

var aiCellReference = regexp.MustCompile(`^[A-Z]{1,3}[1-9][0-9]{0,6}$`)

func (archive aiXMLArchive) sharedStrings() []string {
	data := archive.read("xl/sharedStrings.xml", false)
	if data == nil {
		return nil
	}
	decoder := aiXMLDecoder(data)
	result := []string{}
	size := 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			shared.Fail(http.StatusBadRequest, shared.MsgXLSXStringsCorrupt)
		}
		element, ok := token.(xml.StartElement)
		if !ok || element.Name.Local != "si" {
			continue
		}
		var value aiInlineString
		if decoder.DecodeElement(&value, &element) != nil {
			shared.Fail(http.StatusBadRequest, shared.MsgXLSXStringsInvalid)
		}
		text := value.text()
		size += len(text)
		if len(result) >= 200000 || size > 8*1024*1024 {
			shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgXLSXTextTooLarge)
		}
		result = append(result, text)
	}
	return result
}

func (archive aiXMLArchive) spreadsheetText() string {
	relationships := archive.relationships("xl/_rels/workbook.xml.rels", "xl", "worksheet")
	stringsTable := archive.sharedStrings()
	decoder := aiXMLDecoder(archive.read("xl/workbook.xml", true))
	var output strings.Builder
	count := 0
	hasText := false
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			shared.Fail(http.StatusBadRequest, shared.MsgXLSXWorkbookInvalid)
		}
		element, ok := token.(xml.StartElement)
		if !ok || element.Name.Local != "sheet" {
			continue
		}
		name := relationships[aiRelationshipID(element.Attr)]
		if name == "" {
			continue
		} // Chartsheets do not contain worksheet cells. 图表工作表不包含普通工作表单元格。
		title := ""
		for _, attribute := range element.Attr {
			if attribute.Name.Local == "name" {
				title = attribute.Value
			}
		}
		fmt.Fprintf(&output, "工作表：%s\n", title)
		sheet := aiXMLDecoder(archive.read(name, true))
		count++
		for {
			token, err := sheet.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				shared.Fail(http.StatusBadRequest, shared.MsgXLSXWorksheetInvalid)
			}
			start, ok := token.(xml.StartElement)
			if !ok || start.Name.Local != "c" {
				continue
			}
			var cell aiSpreadsheetCell
			if sheet.DecodeElement(&cell, &start) != nil ||
				!aiCellReference.MatchString(cell.Reference) {
				shared.Fail(http.StatusBadRequest, shared.MsgXLSXCellInvalid)
			}
			value := cell.Value
			switch cell.Type {
			case "s":
				index, err := strconv.Atoi(value)
				if err != nil || index < 0 || index >= len(stringsTable) {
					shared.Fail(http.StatusBadRequest, shared.MsgXLSXTextReferenceInvalid)
				}
				value = stringsTable[index]
			case "inlineStr":
				value = cell.Inline.text()
			case "b":
				if value == "1" {
					value = "TRUE"
				} else if value == "0" {
					value = "FALSE"
				}
			case "", "n", "str", "e", "d":
			default:
				shared.Fail(http.StatusBadRequest, shared.MsgXLSXCellUnsupported)
			}
			if value == "" && cell.Formula != "" {
				value = "=" + cell.Formula
			}
			if value != "" {
				hasText = true
				fmt.Fprintf(&output, "%s\t%s\n", cell.Reference, value)
			}
			if output.Len() > aiAttachmentTextSize {
				shared.Fail(http.StatusRequestEntityTooLarge, shared.MsgOfficeTextTooLarge)
			}
		}
		output.WriteByte('\n')
	}
	if count == 0 || !hasText {
		shared.Fail(http.StatusBadRequest, shared.MsgXLSXTextMissing)
	}
	return output.String()
}
