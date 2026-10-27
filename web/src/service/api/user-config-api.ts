import http from './https';

export type UserConfig = Record<string, unknown>;

export interface UserConfigResponse {
  userConfig: UserConfig;
}

export function getUserConfig(signal?: AbortSignal) {
  return http.get<unknown, UserConfigResponse>('/auth/me/config', { signal });
}

// Send only changed top-level keys: the server owns the shallow assign operation.
export function patchUserConfig(userConfig: UserConfig, signal?: AbortSignal) {
  return http.patch<unknown, UserConfigResponse>('/auth/me/config', { userConfig }, { signal });
}
