import http, { authHttp } from './https';
import {
  acceptSession,
  authUser,
  clearSession,
  type AuthSession,
  type AuthUser,
} from '../auth-session';

export interface ProfileInput {
  name: string;
  email: string;
  phone: string;
  avator?: string;
}

export async function accountAvailability(account: string, signal?: AbortSignal) {
  const { data } = await authHttp.post<{ available: boolean }>(
    '/auth/account-availability',
    { account },
    { signal }
  );
  return data;
}

export async function login(account: string, password: string, expectedUserId?: string) {
  const { data } = await authHttp.post<AuthSession>('/auth/login', { account, password });
  if (expectedUserId && data.user.id !== expectedUserId) {
    throw new Error('请使用原账号重新登录，以保留当前编辑内容');
  }
  acceptSession(data);
  return data.user;
}

export async function register(input: ProfileInput & { account: string; password: string }) {
  const { data } = await authHttp.post<AuthSession>('/auth/register', input);
  acceptSession(data);
  return data.user;
}

export async function updateProfile(input: ProfileInput) {
  const user = await http.patch<unknown, AuthUser>('/auth/me', input);
  authUser.value = user;
  return user;
}

export async function getProfile() {
  const user = await http.get<unknown, AuthUser>('/auth/me');
  authUser.value = user;
  return user;
}

export async function logout() {
  await http.post('/auth/logout');
  clearSession();
}
