import axios, { type InternalAxiosRequestConfig } from 'axios';
import {
  acceptSession,
  accessToken,
  accessExpiresAt,
  authUser,
  expireSession,
  sessionExpired,
  sessionInitialized,
  type AuthSession,
} from '@/service/auth-session';
const baseURL = '/api';
export const authHttp = axios.create({ baseURL, timeout: 30000, withCredentials: true });
let refreshRequest: Promise<AuthSession> | undefined;

export function refreshSession(): Promise<AuthSession> {
  if (!refreshRequest) {
    refreshRequest = authHttp
      .post<AuthSession>('/auth/refresh')
      .then(({ data }) => {
        if (authUser.value && data.user.id !== authUser.value.id) {
          expireSession();
          throw new Error('其他窗口已切换账号，请使用原账号重新登录');
        }
        acceptSession(data);
        return data;
      })
      .catch((error: unknown) => {
        // A temporary outage does not prove the current account has lost its session.
        if (axios.isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0))
          expireSession();
        throw error;
      })
      .finally(() => {
        sessionInitialized.value = true;
        refreshRequest = undefined;
      });
  }
  return refreshRequest;
}

const http = axios.create({
  baseURL: baseURL,
  timeout: 30000,
  withCredentials: true,
});

http.interceptors.request.use(async (config) => {
  if (sessionExpired.value) throw new Error('登录已过期，请重新登录。编辑内容已保留');
  if (accessToken.value && accessExpiresAt.value < Date.now() + 30000) await refreshSession();
  if (accessToken.value) config.headers.set('Authorization', `Bearer ${accessToken.value}`);
  return config;
});

http.interceptors.response.use(
  (response) => response.data,
  async (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && error.config) {
      if (sessionExpired.value) {
        return Promise.reject(new Error('登录已过期，请重新登录。编辑内容已保留'));
      }
      const config = error.config as InternalAxiosRequestConfig & { authRetried?: boolean };
      if (!config.authRetried) {
        config.authRetried = true;
        // A late 401 from the previous token reuses an already refreshed session.
        const sentToken = config.headers.get('Authorization');
        if (!accessToken.value || sentToken === `Bearer ${accessToken.value}`) {
          try {
            await refreshSession();
          } catch (cause) {
            if (axios.isAxiosError(cause) && [401, 403].includes(cause.response?.status ?? 0))
              return Promise.reject(new Error('登录已过期，请重新登录。编辑内容已保留'));
            // Preserve transient HTTP/network classification for bounded collaboration retries.
            return Promise.reject(cause);
          }
        }
        return http.request(config);
      }
      expireSession();
    }
    return Promise.reject(error);
  }
);

export default http;
