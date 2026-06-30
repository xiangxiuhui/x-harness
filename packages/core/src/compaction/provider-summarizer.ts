/**
 * ADR-0013 F1 — Provider-backed Summarizer.
 *
 * Wraps any Provider into a `Summarizer` (transcript → summary) that:
 *   • routes the request to `provider.auxModel` when available, else `defaultModel`
 *   • injects the filter-safe preamble as system message
 *   • passes the transcript as a single user message
 *   • collects streamed deltaContent into a string
 *
 * Provider-agnostic: works with DeepSeek, future OpenAI/Anthropic, etc.
 * Pure data flow — no side effects beyond the provider call itself.
 */

import type { Provider } from '@x_harness/provider';
import type { Summarizer } from './compact.js';

export interface MakeProviderSummarizerOptions {
  /** Override the model used for summarization. Default: provider.auxModel ?? provider.defaultModel. */
  model?: string;
  /** Forwarded to provider (defaults to 0.3 for deterministic-leaning summaries). */
  temperature?: number;
  /** Hard cap on summary length (provider-side). */
  maxTokens?: number;
}

/**
 * Wrap a `Provider` into a `Summarizer` callable that Session can consume.
 *
 * The returned function:
 *   1. picks `opts.model ?? provider.auxModel ?? provider.defaultModel`
 *   2. assembles `[{role:'system', content: preamble}, {role:'user', content: transcript}]`
 *   3. streams the response, accumulating deltaContent
 *   4. returns the final string (trimmed)
 *
 * Errors bubble up; Session's `maybeCompactBeforeTurn` catches them and
 * emits an 'error' bus event without breaking the active turn.
 */
export function makeProviderSummarizer(
  provider: Provider,
  opts: MakeProviderSummarizerOptions = {},
): Summarizer {
  const model = opts.model ?? provider.auxModel ?? provider.defaultModel;
  const temperature = opts.temperature ?? 0.3;
  const maxTokens = opts.maxTokens ?? 1200;

  return async (transcript, preamble, signal) => {
    let out = '';
    for await (const chunk of provider.chat(
      {
        model,
        messages: [
          { role: 'system', content: preamble },
          { role: 'user', content: transcript },
        ],
        temperature,
        maxTokens,
      },
      signal,
    )) {
      if (chunk.deltaContent) out += chunk.deltaContent;
    }
    return out.trim();
  };
}

/** Convenience: report which model would actually be used (for logging / tests). */
export function resolveSummarizerModel(
  provider: Provider,
  opts: MakeProviderSummarizerOptions = {},
): string {
  return opts.model ?? provider.auxModel ?? provider.defaultModel;
}
