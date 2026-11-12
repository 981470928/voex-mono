/** ---------- Types ---------- / 类型 */

/** API error response shape / API 错误响应结构 */
export interface ApiError {
  error: string;
  [key: string]: unknown;
}
