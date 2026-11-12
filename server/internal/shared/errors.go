package shared

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"

	driver "github.com/go-sql-driver/mysql"
	mysql "gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// CodeAIReviewConflict is the existing client-visible review discriminator.
// CodeAIReviewConflict 是现有客户端可见的审阅冲突标识。
const CodeAIReviewConflict = "ai_review_conflict"

// HTTPError carries a deliberate business failure. PublicError sanitizes internal failures.
// HTTPError 表示明确的业务失败；PublicError 会净化内部错误信息。
type HTTPError struct {
	Code    int
	Status  int
	Message string
}

func (e HTTPError) Error() string     { return fmt.Sprintf("Code: %d, Msg: %s", e.Code, e.Message) }
func Fail(status int, message string) { panic(HTTPError{Status: status, Message: message}) }

type networkError struct {
	operation string
	cause     error
}

func (e networkError) Error() string { return e.operation + ": " + e.cause.Error() }
func (e networkError) Unwrap() error { return e.cause }

// NetworkFailure retains diagnostics for the boundary without exposing them to clients.
// NetworkFailure 为边界层保留诊断信息，不向客户端暴露这些信息。
func NetworkFailure(operation string, cause error) {
	if cause == nil {
		cause = errors.New("upstream operation failed")
	}
	panic(networkError{operation: operation, cause: cause})
}
func UpstreamFailure(operation string, status int) {
	NetworkFailure(operation, fmt.Errorf("upstream status %d", status))
}

// DatabaseError delegates vendor-code translation to the installed GORM dialector.
// Keep the original error at call sites so logs retain the database diagnostic.
// DatabaseError 将数据库厂商错误码的转换交给已安装的 GORM dialector。
// 调用处保留原始错误，使日志仍包含数据库诊断信息。
func DatabaseError(err error) error {
	var vendor *driver.MySQLError
	if errors.As(err, &vendor) && vendor != nil {
		return (mysql.Dialector{}).Translate(vendor)
	}
	return err
}

// LogFailure excludes request URLs (which may contain tokens), headers and provider bodies.
// LogFailure 排除请求 URL（其中可能包含令牌）、请求头和服务提供方响应体。
func LogFailure(operation string, failure any) {
	if err, ok := failure.(error); ok {
		var network networkError
		if errors.As(err, &network) {
			operation += ": " + network.operation
		}
		var request *url.Error
		if errors.As(err, &request) && request != nil {
			err = request.Err
		}
		var file *fs.PathError
		if errors.As(err, &file) && file != nil {
			err = fmt.Errorf("%s: %w", file.Op, file.Err)
		}
		var database *driver.MySQLError
		if errors.As(err, &database) && database != nil {
			log.Printf(
				"[API] %s failed (type=%T mysql=%d sqlstate=%s)",
				operation,
				failure,
				database.Number,
				database.SQLState,
			)
			return
		}
		log.Printf("[API] %s failed (type=%T): %v", operation, failure, err)
		return
	}
	log.Printf("[API] %s failed (type=%T)", operation, failure)
}

// PublicError is shared by JSON recovery and SSE. Never classify failures by their text.
// JSON 恢复处理和 SSE 共用 PublicError；绝不根据错误文本进行分类。
func PublicError(failure any) HTTPError {
	result := HTTPError{Status: http.StatusInternalServerError, Message: MsgInternalError}
	err, ok := failure.(error)
	if !ok {
		LogFailure("request", failure)
		return result
	}
	var explicit HTTPError
	var pointer *HTTPError
	deliberate := false
	if errors.As(err, &explicit) {
		result, deliberate = explicit, true
	} else if errors.As(err, &pointer) && pointer != nil {
		result, deliberate = *pointer, true
	}
	if deliberate {
		switch {
		case result.Status == http.StatusBadGateway || result.Status == http.StatusGatewayTimeout:
			result.Status, result.Message = http.StatusBadGateway, MsgNetworkError
		case result.Status == http.StatusServiceUnavailable:
			result.Message = MsgServiceUnavailable
		case result.Status >= http.StatusInternalServerError ||
			result.Status < http.StatusBadRequest:
			result.Status, result.Message = http.StatusInternalServerError, MsgInternalError
		}
		if result.Status >= http.StatusInternalServerError {
			LogFailure("request", err)
		}
		return result
	}
	var oversized *http.MaxBytesError
	var network networkError
	var connection net.Error
	translated := DatabaseError(err)
	switch {
	case errors.As(err, &oversized):
		result = HTTPError{
			Status:  http.StatusRequestEntityTooLarge,
			Message: SizeLimitMessage("上传文件"),
		}
	case errors.As(err, &network),
		errors.As(err, &connection),
		errors.Is(err, context.Canceled),
		errors.Is(err, context.DeadlineExceeded):
		result = HTTPError{Status: http.StatusBadGateway, Message: MsgNetworkError}
	case errors.Is(translated, gorm.ErrDuplicatedKey):
		result = HTTPError{Status: http.StatusConflict, Message: MsgResourceConflict}
	case errors.Is(translated, gorm.ErrForeignKeyViolated):
		result = HTTPError{Status: http.StatusConflict, Message: MsgResourceRelationChanged}
	}
	LogFailure("request", err)
	return result
}
