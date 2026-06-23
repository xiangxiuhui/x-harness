/**
 * @x_harness/provider — LLM provider abstraction.
 *
 * Spiral 1: DeepSeek only (OpenAI-compatible).
 * The interface is intentionally minimal — see ADR-0003.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: Role;
  content: string;
  /** Tool call id when role === 'tool' */
  toolCallId?: string;
  /** Tool calls emitted by an assistant message */
  toolCalls?: ToolCall[];
  /** Free-form, not sent to provider; for x_harness internal bookkeeping (actor, ts, ...). */
  meta?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw arguments as JSON-encoded string (OpenAI shape). */
  argumentsJson: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** OpenAI-style JSON schema for parameters. */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model?: string;
  messages: Message[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  /** Provider-specific, opaque to core. */
  metadata?: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

export interface ChatChunk {
  /** Incremental content delta. */
  deltaContent?: string;
  /** Incremental tool-call deltas (OpenAI streaming shape). */
  deltaToolCalls?: Array<{
    index: number;
    id?: string;
    name?: string;
    argumentsJson?: string;
  }>;
  finishReason?: FinishReason;
  usage?: TokenUsage;
}

export interface Provider {
  readonly name: string;
  readonly defaultModel: string;
  chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk>;
}

export { DeepSeekProvider, createDeepSeekProviderFromEnv } from './deepseek.js';
