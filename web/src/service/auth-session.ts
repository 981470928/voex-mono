import { computed, ref, shallowRef } from 'vue';

export interface Creator {
  id: string;
  name: string;
  avator: string;
}

export interface AuthUser extends Creator {
  account: string;
  email: string;
  phone: string;
}

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

// Credentials and tokens intentionally live only in memory.
export const authUser = shallowRef<AuthUser | null>(null);
export const accessToken = ref('');
export const accessExpiresAt = ref(0);
export const sessionExpired = ref(false);
export const sessionInitialized = ref(false);
export const authenticated = computed(() => !!accessToken.value && !sessionExpired.value);

export function acceptSession(session: AuthSession) {
  authUser.value = session.user;
  accessToken.value = session.accessToken;
  accessExpiresAt.value = Date.now() + session.expiresIn * 1000;
  sessionExpired.value = false;
  sessionInitialized.value = true;
}

export function expireSession() {
  accessToken.value = '';
  accessExpiresAt.value = 0;
  sessionExpired.value = !!authUser.value;
}

export function clearSession() {
  authUser.value = null;
  accessToken.value = '';
  accessExpiresAt.value = 0;
  sessionExpired.value = false;
  sessionInitialized.value = true;
}
