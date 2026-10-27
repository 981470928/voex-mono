export type AIProtocol = 'openai' | 'anthropic';

export interface AIModel {
  id: string;
  name: string;
  protocol: AIProtocol;
  base_url: string;
  model: string;
  temperature: number | null;
  max_tokens: number;
  token_parameter: 'max_completion_tokens' | 'max_tokens';
  has_key: boolean;
}

export interface DocumentSnapshot {
  file_key: string;
  file_name: string;
  project_key: string;
  folder_key: string;
  content: string;
  revision: number;
  writable: boolean;
}

export interface DocumentChange {
  kind: 'create' | 'update';
  file_key: string;
  project_key: string;
  folder_key: string;
  before_name: string;
  after_name: string;
  before_content: string;
  after_content: string;
  revision: number;
}

export interface ReviewSummary {
  id: string;
  createdAt: number;
  status: 'pending' | 'applied';
  fileCount: number;
}

export interface ReviewSnapshot extends ReviewSummary {
  changes: DocumentChange[];
}

export interface ChatMessage {
  id: string;
  turnId: string;
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string;
  activity?: string[];
  review?: ReviewSummary;
  error?: string;
  state?: 'incomplete' | 'complete';
  persistence?: 'saving' | 'failed';
  persistenceError?: string;
  createdAt?: number;
}

export interface AIConversationSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationSessionPage {
  sessions: AIConversationSession[];
  nextCursor: string;
}

export interface ConversationPage {
  messages: ChatMessage[];
  nextCursor: string;
}

export interface TurnResponseInput {
  text: string;
  activity: string[];
  error: string;
  review?: Pick<ReviewSnapshot, 'id' | 'changes'>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ModelMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; reasoning?: string; calls: ToolCall[]; blocks?: unknown[] }
  | { role: 'tool'; callId: string; text: string; isError: boolean };

export interface ToolProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  items?: ToolProperty;
  properties?: Record<string, ToolProperty>;
  required?: string[];
  additionalProperties?: false;
}

export interface ToolSchema extends ToolProperty {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required: string[];
  additionalProperties: false;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolSchema;
}

export interface AgentContext {
  document: DocumentSnapshot;
  userRequest: string;
  allowExport: boolean;
  signal: AbortSignal;
}

export interface AgentTool extends ToolDefinition {
  /** Runtime checks are enforced even when a provider ignores the schema. */
  execute: (input: Record<string, unknown>, context: AgentContext) => unknown | Promise<unknown>;
}
