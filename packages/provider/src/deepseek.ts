import type {
  ChatChunk,
  ChatRequest,
  Message,
  Provider,
  ToolSpec,
} from './index.js';

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * DeepSeek provider (OpenAI-compatible Chat Completions API).
 *
 * Docs: https://api-docs.deepseek.com/
 */
export class DeepSeekProvider implements Provider {
  readonly name = 'deepseek';
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(cfg: DeepSeekConfig) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = (cfg.baseUrl ?? 'https://api.deepseek.com').replace(/\/$/, '');
    this.defaultModel = cfg.defaultModel ?? 'deepseek-chat';
  }

  async *chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const body = {
      model: req.model ?? this.defaultModel,
      messages: req.messages.map(toOpenAiMessage),
      stream: true,
      ...(req.tools && req.tools.length > 0
        ? { tools: req.tools.map(toOpenAiTool), tool_choice: 'auto' as const }
        : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    };

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`DeepSeek HTTP ${resp.status}: ${text || resp.statusText}`);
    }

    yield* parseSse(resp.body);
  }
}

function toOpenAiMessage(m: Message): Record<string, unknown> {
  const base: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.role === 'tool' && m.toolCallId) {
    base.tool_call_id = m.toolCallId;
  }
  if (m.toolCalls && m.toolCalls.length > 0) {
    base.tool_calls = m.toolCalls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: c.argumentsJson },
    }));
  }
  return base;
}

function toOpenAiTool(t: ToolSpec): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  };
}

/**
 * Parse an OpenAI-style SSE stream (data: {...}\n\n, terminated by `).
 */
async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<ChatChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIdx: number;
      while ((nlIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nlIdx).replace(/\r$/, '');
        buffer = buffer.slice(nlIdx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') return;
        let json: unknown;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const chunk = openAiStreamChunkToChunk(json);
        if (chunk) yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface OpenAiStreamChoice {
  index: number;
  delta?: {
    content?: string;
    tool_calls?: Array<{
      index: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
}

interface OpenAiStreamPayload {
  choices?: OpenAiStreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function openAiStreamChunkToChunk(raw: unknown): ChatChunk | null {
  const p = raw as OpenAiStreamPayload;
  if (!p || typeof p !== 'object') return null;
  const choice = p.choices?.[0];
  const out: ChatChunk = {};

  if (choice?.delta?.content) {
    out.deltaContent = choice.delta.content;
  }
  if (choice?.delta?.tool_calls && choice.delta.tool_calls.length > 0) {
    out.deltaToolCalls = choice.delta.tool_calls.map((c) => ({
      index: c.index,
      id: c.id,
      name: c.function?.name,
      argumentsJson: c.function?.arguments,
    }));
  }
  if (choice?.finish_reason) {
    const fr = choice.finish_reason;
    out.finishReason =
      fr === 'stop' || fr === 'tool_calls' || fr === 'length' ? fr : 'error';
  }
  if (p.usage) {
    out.usage = {
      promptTokens: p.usage.prompt_tokens ?? 0,
      completionTokens: p.usage.completion_tokens ?? 0,
      totalTokens: p.usage.total_tokens ?? 0,
    };
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Build a DeepSeekProvider from process env. Throws if DEEPSEEK_API_KEY is missing.
 */
export function createDeepSeekProviderFromEnv(): DeepSeekProvider {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      'DEEPSEEK_API_KEY is not set. Export it or put it in .env (see packages/provider/.env.example).',
    );
  }
  return new DeepSeekProvider({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    defaultModel: process.env.DEEPSEEK_MODEL,
  });
}
