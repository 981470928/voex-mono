import http from './https';
import type { ApiError } from './index';
import type {
  AIModel,
  AIConversationSession,
  ConversationSessionPage,
  ChatMessage,
  ConversationPage,
  ReviewSnapshot,
  TurnResponseInput,
} from '@/agent/types';

export function listAIModels(signal?: AbortSignal) {
  return http.get<ApiError, AIModel[]>('/ai/models', { signal });
}

export function saveAIModel(model: Omit<AIModel, 'has_key'> & { api_key: string }) {
  const { id, ...body } = model;
  return http.put<ApiError, AIModel>(`/ai/models/${encodeURIComponent(id)}`, body);
}

export function deleteAIModel(id: string) {
  return http.delete<ApiError, { success: boolean }>(`/ai/models/${encodeURIComponent(id)}`);
}

async function readAIChatStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal
): Promise<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) throw new Error('AI 连接已结束，但未收到完整结果，请重新发送');
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      if (buffer.length > 2 * 1024 * 1024 + 1024)
        throw new Error('AI 响应超过大小限制，请缩小修改范围');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = '';
        const data: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        // SSE comments are heartbeats, not completed model responses.
        if (event !== 'result' && event !== 'error') continue;
        let payload: unknown;
        try {
          payload = JSON.parse(data.join('\n'));
        } catch {
          throw new Error('AI 响应格式不正确，请稍后重试');
        }
        if (event === 'result') return payload;
        const message =
          payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined;
        throw new Error(typeof message === 'string' ? message : '模型请求失败，请稍后重试');
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function requestAIChat(id: string, body: unknown, signal: AbortSignal) {
  const stream = await http.post<ApiError, ReadableStream<Uint8Array>>(
    `/ai/models/${encodeURIComponent(id)}/chat`,
    body,
    {
      signal,
      timeout: 0,
      adapter: 'fetch',
      responseType: 'stream',
      headers: { Accept: 'text/event-stream' },
    }
  );
  return readAIChatStream(stream, signal);
}

export interface AppliedDocument {
  file_key: string;
  file_name: string;
  revision: number;
  replayed?: boolean;
}

export function applyAIReview(review: ReviewSnapshot) {
  return http.post<ApiError, AppliedDocument[]>(
    `/ai/reviews/${encodeURIComponent(review.id)}/apply`,
    {}
  );
}

export function listAIConversations(fileKey: string, before = '', signal?: AbortSignal) {
  return http.get<ApiError, ConversationSessionPage>(
    `/ai/conversations/${encodeURIComponent(fileKey)}/sessions`,
    { signal, params: before ? { before } : undefined }
  );
}

export function createAIConversation(fileKey: string, id: string, signal?: AbortSignal) {
  return http.put<ApiError, AIConversationSession>(
    `/ai/conversations/${encodeURIComponent(fileKey)}/sessions/${encodeURIComponent(id)}`,
    {},
    { signal }
  );
}

export function deleteAIConversation(fileKey: string, id: string, signal?: AbortSignal) {
  return http.delete<ApiError, { success: boolean }>(
    `/ai/conversations/${encodeURIComponent(fileKey)}/sessions/${encodeURIComponent(id)}`,
    { signal }
  );
}

export function getAIConversation(
  fileKey: string,
  sessionId: string,
  before = '',
  signal?: AbortSignal
) {
  return http.get<ApiError, ConversationPage>(`/ai/conversations/${encodeURIComponent(fileKey)}`, {
    signal,
    params: { session_id: sessionId, ...(before ? { before } : {}) },
  });
}

export function beginAITurn(
  fileKey: string,
  sessionId: string,
  id: string,
  modelId: string,
  prompt: string,
  signal: AbortSignal
) {
  return http.put<ApiError, ChatMessage[]>(
    `/ai/conversations/${encodeURIComponent(fileKey)}/turns/${encodeURIComponent(id)}`,
    { session_id: sessionId, model_id: modelId, prompt },
    { signal }
  );
}

export function finishAITurn(
  fileKey: string,
  id: string,
  input: TurnResponseInput,
  signal: AbortSignal
) {
  return http.put<ApiError, ChatMessage[]>(
    `/ai/conversations/${encodeURIComponent(fileKey)}/turns/${encodeURIComponent(id)}/response`,
    input,
    { signal }
  );
}

export function getAIReview(id: string, signal?: AbortSignal) {
  return http.get<ApiError, ReviewSnapshot>(`/ai/reviews/${encodeURIComponent(id)}`, { signal });
}
