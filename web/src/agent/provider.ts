import { requestAIChat } from '@/service/api/ai-api';
import type { AIModel, ModelMessage, ToolCall, ToolDefinition } from './types';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('模型响应格式不正确');
  return value as Record<string, unknown>;
}

function openAIMessages(system: string, history: ModelMessage[]) {
  return [
    { role: 'system', content: system },
    ...history.map((message) => {
      if (message.role === 'user') return { role: 'user', content: message.text };
      if (message.role === 'tool')
        return { role: 'tool', tool_call_id: message.callId, content: message.text };
      return {
        role: 'assistant',
        content: message.text || null,
        ...(message.reasoning !== undefined && { reasoning_content: message.reasoning }),
        ...(message.calls.length && {
          tool_calls: message.calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          })),
        }),
      };
    }),
  ];
}

function anthropicMessages(history: ModelMessage[]) {
  const result: { role: 'user' | 'assistant'; content: unknown[] }[] = [];
  for (const message of history) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const content: unknown[] =
      message.role === 'tool'
        ? [
            {
              type: 'tool_result',
              tool_use_id: message.callId,
              content: message.text,
              is_error: message.isError,
            },
          ]
        : message.role === 'assistant'
          ? (message.blocks ?? [
              ...(message.text ? [{ type: 'text', text: message.text }] : []),
              ...message.calls.map((call) => ({
                type: 'tool_use',
                id: call.id,
                name: call.name,
                input: JSON.parse(call.arguments) as unknown,
              })),
            ])
          : [{ type: 'text', text: message.text }];
    const previous = result.at(-1);
    if (previous?.role === role) previous.content.push(...content);
    else result.push({ role, content });
  }
  return result;
}

export async function completeModel(
  model: AIModel,
  system: string,
  history: ModelMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal
): Promise<Extract<ModelMessage, { role: 'assistant' }>> {
  const anthropic = model.protocol === 'anthropic';
  const body = anthropic
    ? {
        system,
        messages: anthropicMessages(history),
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
      }
    : {
        messages: openAIMessages(system, history),
        tools: tools.map((tool) => ({ type: 'function', function: tool })),
      };
  const data = record(await requestAIChat(model.id, body, signal));
  signal.throwIfAborted();
  if (data.error) throw new Error('模型服务返回错误，请检查模型配置');
  const calls: ToolCall[] = [];
  let text = '';
  let reasoning = '';
  if (anthropic) {
    if (data.stop_reason === 'max_tokens')
      throw new Error('模型输出被截断，请增加输出上限或缩小修改范围');
    if (!Array.isArray(data.content)) throw new Error('Claude Messages 响应缺少 content');
    for (const value of data.content) {
      const block = record(value);
      if (block.type === 'thinking' && typeof block.thinking === 'string')
        reasoning += (reasoning ? '\n\n' : '') + block.thinking;
      if (block.type === 'text' && typeof block.text === 'string') text += block.text;
      if (block.type === 'tool_use') {
        if (typeof block.id !== 'string' || typeof block.name !== 'string')
          throw new Error('工具调用格式不正确');
        calls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
      }
    }
    return { role: 'assistant', text, reasoning, calls, blocks: data.content };
  }
  if (!Array.isArray(data.choices) || !data.choices.length)
    throw new Error('OpenAI Chat 响应缺少 choices');
  const choice = record(data.choices[0]);
  if (choice.finish_reason === 'length')
    throw new Error('模型输出被截断，请增加输出上限或缩小修改范围');
  const message = record(choice.message);
  const reasoningContent =
    typeof message.reasoning_content === 'string' ? message.reasoning_content : undefined;
  if (typeof message.content === 'string') text = message.content;
  if (Array.isArray(message.tool_calls)) {
    for (const value of message.tool_calls) {
      const call = record(value);
      const fn = record(call.function);
      if (
        typeof call.id !== 'string' ||
        typeof fn.name !== 'string' ||
        typeof fn.arguments !== 'string'
      )
        throw new Error('工具调用格式不正确');
      calls.push({ id: call.id, name: fn.name, arguments: fn.arguments });
    }
  }
  if (typeof message.refusal === 'string' && !text) text = message.refusal;
  return { role: 'assistant', text, reasoning: reasoningContent, calls };
}
