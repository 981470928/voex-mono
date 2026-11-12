import { format } from "node:util";
import { constants as httpStatus } from 'node:http2';

export { httpStatus };

// User-facing error messages and templates. Edit this constant table directly.
// 面向用户的错误消息和模板，直接修改此常量表。
export const Messages = {
  BooleanType: "布尔值",
  CollaborationSnapshotFieldsInvalid: "协作快照包含未知共享字段",
  ConversionActionInvalid: "转换操作无效",
  ConversionDocumentInvalid: "文档格式无效或不受支持",
  DocumentChanged: "文档状态已变化，请刷新后重试",
  DocumentInitializationPending: "文档初始化未完成",
  DocumentSchemaMismatch: "文档 schema 版本不兼容",
  DocumentSchemaRequired: "原生文档缺少 schema 版本",
  DocumentSourceExclusive: "必须提供唯一的正文来源",
  DocumentStateChanged: "文档状态已变化",
  EditorVersionMismatch: "编辑器版本不兼容，请刷新页面",
  FieldFormatInvalid: "%s格式错误",
  FieldMustBe: "%s 必须是%s",
  ImportTargetRequired: "缺少导入目标标识",
  InternalError: "服务器处理失败，请稍后重试",
  InvalidRequest: "请求格式无效，请检查后重试",
  MethodNotAllowed: "请求方法不支持",
  NetworkError: "网络异常，请稍后重试",
  NoAccessPermission: "没有访问权限",
  NoEditPermission: "没有编辑权限",
  PendingLocalChanges: "本地修改尚未到达服务器，请重试保存",
  PermissionDenied: "你没有权限",
  ReconnectDocumentChanged: "文档状态已变化，请重新连接",
  ReconnectOriginalAccount: "请使用原编辑账号重新连接",
  RequestPreconditionFailed: "文件已发生变化，请确认后强制应用此建议",
  ResourceNotFound: "%s不存在",
  ReviewConfirmationPending: "仍有审阅事务等待确认，请稍后重试排空",
  ReviewInProgress: "另一个审阅正在应用",
  ServiceUnavailable: "服务暂不可用，请稍后重试",
  SessionExpired: "登录已过期，请重新登录",
  SizeLimitExceeded: "%s超过大小限制",
  StorageAuthorizationExpired: "存储授权已失效，请保留当前页面并重新登录",
  TooManyRequests: "尝试次数过多，请稍后重试",
} as const;

// These helpers only fill fields in the constant templates.
// 这些辅助函数仅填充常量模板中的字段。
export function mustBeMessage(field: string, requirement: string): string {
  return format(Messages.FieldMustBe, field, requirement);
}
export function notFoundMessage(resource: string): string {
  return format(Messages.ResourceNotFound, resource);
}
export function invalidFormatMessage(field: string): string {
  return format(Messages.FieldFormatInvalid, field);
}
export function sizeLimitMessage(subject: string): string {
  return format(Messages.SizeLimitExceeded, subject);
}

// Application protocol values have no matching framework constant. Keep existing clients compatible.
// 应用协议值没有对应的框架常量，需保持与现有客户端兼容。
export const StatusClientClosedRequest = 499;
export const SocketCloseCode = Object.freeze({
  TryAgainLater: 1013,
  PresenceReplaced: 4000,
  AuthenticationExpired: 4001,
  PermissionChanged: 4003,
});

const logged = new WeakSet<object>();
export function logFailure(operation: string, error: unknown) {
  if (error instanceof Error) {
    if (logged.has(error)) return;
    logged.add(error);
    console.error(`[collaboration] ${operation} failed`, error);
  } else console.error(`[collaboration] ${operation} failed (non-error failure)`);
}

export function messageForStatus(status: number): string {
  switch (status) {
    case httpStatus.HTTP_STATUS_UNAUTHORIZED: return Messages.SessionExpired;
    case httpStatus.HTTP_STATUS_FORBIDDEN: return Messages.PermissionDenied;
    case httpStatus.HTTP_STATUS_NOT_FOUND: return notFoundMessage("文档");
    case httpStatus.HTTP_STATUS_METHOD_NOT_ALLOWED: return Messages.MethodNotAllowed;
    case httpStatus.HTTP_STATUS_CONFLICT: return Messages.DocumentChanged;
    case httpStatus.HTTP_STATUS_PRECONDITION_FAILED: return Messages.RequestPreconditionFailed;
    case httpStatus.HTTP_STATUS_PAYLOAD_TOO_LARGE: return sizeLimitMessage("请求内容");
    case httpStatus.HTTP_STATUS_TOO_MANY_REQUESTS: return Messages.TooManyRequests;
    case httpStatus.HTTP_STATUS_BAD_GATEWAY:
    case httpStatus.HTTP_STATUS_GATEWAY_TIMEOUT:
    case StatusClientClosedRequest: return Messages.NetworkError;
    case httpStatus.HTTP_STATUS_SERVICE_UNAVAILABLE: return Messages.ServiceUnavailable;
    default: return status >= httpStatus.HTTP_STATUS_BAD_REQUEST && status < httpStatus.HTTP_STATUS_INTERNAL_SERVER_ERROR
      ? Messages.InvalidRequest : Messages.InternalError;
  }
}

export class ServiceError extends Error {
  constructor(message: string, readonly status: number = httpStatus.HTTP_STATUS_SERVICE_UNAVAILABLE, options?: ErrorOptions) {
    super(message, options);
    if (status >= httpStatus.HTTP_STATUS_INTERNAL_SERVER_ERROR) logFailure('service request', this);
  }
}

// HTTP, persistence broadcasts and explicit-save replies share the same safe boundary.
// HTTP、持久化广播和显式保存响应使用相同的安全处理边界。
export function publicFailure(error: unknown, operation: string) {
  if (!(error instanceof ServiceError)) {
    logFailure(operation, error);
    return { status: httpStatus.HTTP_STATUS_INTERNAL_SERVER_ERROR, message: Messages.InternalError };
  }
  if (error.status >= httpStatus.HTTP_STATUS_INTERNAL_SERVER_ERROR) {
    logFailure(operation, error);
    const status = error.status === httpStatus.HTTP_STATUS_GATEWAY_TIMEOUT ? httpStatus.HTTP_STATUS_BAD_GATEWAY : error.status;
    return { status, message: messageForStatus(status) };
  }
  return { status: error.status, message: error.message };
}
