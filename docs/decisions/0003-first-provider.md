# ADR 0003 — 第一螺旋 Model Provider：DeepSeek

状态：**Accepted**
日期：2026-06-18

## Decision

第一螺旋 **唯一接入** [DeepSeek API](https://api-docs.deepseek.com/)。

不在第一螺旋接其他 provider，但 `packages/provider` 的接口设计**必须从 day 1 就抽象**，避免日后改动外溢。

## Why DeepSeek

- 用户指定。
- API 兼容 OpenAI Chat Completions 协议 → 后续接 OpenAI/兼容家族成本极低。
- 价格友好，便于"自己每天用得起"，符合螺旋目标"最小可用闭环 + 自己用起来"。
- 支持 function calling / tool use（screen 抓 OpenAI compatible tool spec 即可）。

## Provider 抽象（packages/provider）

```ts
// 不过度设计；只暴露 x_harness core 真正需要的能力。
export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolSpec[];
  // 不暴露 provider-specific 选项；扩展项进 metadata
  metadata?: Record<string, unknown>;
}

export interface ChatChunk {
  delta?: { content?: string; toolCalls?: ToolCall[] };
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: TokenUsage;
}

export interface Provider {
  name: string;                                    // 'deepseek'
  defaultModel: string;                            // 'deepseek-chat'
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;
}
```

第一螺旋实现：
- `DeepSeekProvider`（OpenAI-compatible HTTP，`base_url = https://api.deepseek.com`）
- 流式 SSE 解析
- tool calling（OpenAI tool 格式）
- 失败重试 / 超时（保守默认值）

## 配置

API key 通过环境变量读取，不入库：

```
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com   # 可选，默认即此
DEEPSEEK_MODEL=deepseek-chat                 # 可选，默认 deepseek-chat
```

`packages/provider/.env.example` 提供模板；`.gitignore` 已忽略 `.env*`。

## 模型选型（第一螺旋 default）

- **chat**：`deepseek-chat`（V3 系列，通用）
- **reasoning**：先不接 `deepseek-reasoner`（R1）；等 reasoning 触发条件清晰再加。

## 与 actor 的关系

每次 `chat()` 调用前，core 必须为本次请求生成一个 actor：

```ts
{ kind: 'model', provider: 'deepseek', model: 'deepseek-chat', sessionId }
```

actor 在请求开始前注册到 actor 总线，所有 tool call 自动继承该 actor，直到 model 转交回 human。

## Open Questions

- DeepSeek 是否会在国内某些网络下抖动 → 需要请求级超时与重试策略观测后再调。
- 后续接快手内部 model 时，是否复用 DeepSeek 的 OpenAI-compatible adapter？（建议：是，单独 `KuaishouProvider` 但底层共享 OpenAI-compatible HTTP 客户端）
