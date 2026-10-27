import { isAxiosError } from 'axios';

export function errorMessage(error: unknown, fallback = '操作失败，请重试'): string {
  if (isAxiosError(error)) {
    const message: unknown = error.response?.data?.error;
    if (typeof message === 'string') return message;
    if (!error.response) return '无法连接服务器，请检查网络后重试';
  }
  return error instanceof Error ? error.message : fallback;
}
