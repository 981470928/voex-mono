/** ---------- Types ---------- */

/** API error response shape */
export interface ApiError {
  error: string;
  [key: string]: unknown;
}
