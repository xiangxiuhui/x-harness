/**
 * ADR-0013 Step 5 — Real BPE tokenizer adapter.
 *
 * Wraps `js-tiktoken` into the minimal `Tokenizer` interface that
 * `token-estimator.ts` consumes. Two design constraints:
 *
 *   1. Encoder construction is expensive (loads ranks JSON, builds tables).
 *      We memoize per-encoding so a session pays the cost exactly once.
 *
 *   2. Encoding choice should fail-soft: if a caller asks for a model we
 *      don't have a mapping for, we fall back to `o200k_base` (the modern
 *      OpenAI/most-frontier choice). If js-tiktoken itself throws during
 *      load (corrupt install, etc.) we degrade to the heuristic from
 *      `token-estimator.ts` so threshold logic still works.
 *
 * Why o200k_base as default:
 *   - GPT-4o, GPT-5 family all use o200k
 *   - DeepSeek's tokenizer is closer to cl100k but a ±5% bias on
 *     threshold decisions is acceptable; precision matters less than
 *     stability (we trigger compaction a touch early on DeepSeek, which
 *     is the safe direction).
 */

import {
  getEncoding,
  getEncodingNameForModel,
  type Tiktoken,
  type TiktokenEncoding,
  type TiktokenModel,
} from 'js-tiktoken';

import type { Tokenizer } from './token-estimator.js';
import { heuristicCount } from './token-estimator.js';

/** Cache of constructed Tiktoken instances, keyed by encoding name. */
const encodingCache = new Map<string, Tiktoken>();

function getEncodingCached(name: TiktokenEncoding): Tiktoken {
  let enc = encodingCache.get(name);
  if (!enc) {
    enc = getEncoding(name);
    encodingCache.set(name, enc);
  }
  return enc;
}

/**
 * Resolve the right encoding for a model string and return a cached Tiktoken.
 * Unknown model → o200k_base. Routes through `getEncodingNameForModel` so we
 * hit the encoding-keyed cache (sharing one Tiktoken across all models that
 * use the same BPE).
 */
function encodingForModelSafe(model: string | undefined): Tiktoken {
  if (model) {
    try {
      const name = getEncodingNameForModel(model as TiktokenModel);
      return getEncodingCached(name);
    } catch {
      /* fall through */
    }
  }
  return getEncodingCached('o200k_base');
}

/**
 * Build a `Tokenizer` callable bound to a given model (or the o200k default).
 *
 * Falls back to the char/3.6 heuristic on ANY failure so threshold logic
 * remains live even with a broken encoder install.
 */
export function makeTiktokenTokenizer(model?: string): Tokenizer {
  let enc: Tiktoken | null = null;
  try {
    enc = encodingForModelSafe(model);
  } catch {
    enc = null;
  }
  if (!enc) return heuristicCount;
  return (text: string) => {
    if (!text) return 0;
    try {
      return enc!.encode(text).length;
    } catch {
      return heuristicCount(text);
    }
  };
}

/** Build a tokenizer for a known encoding (when you don't have a model name). */
export function makeTiktokenTokenizerByEncoding(name: TiktokenEncoding): Tokenizer {
  let enc: Tiktoken | null = null;
  try {
    enc = getEncodingCached(name);
  } catch {
    enc = null;
  }
  if (!enc) return heuristicCount;
  return (text: string) => {
    if (!text) return 0;
    try {
      return enc!.encode(text).length;
    } catch {
      return heuristicCount(text);
    }
  };
}

/** Re-export for caller convenience. */
export type { TiktokenEncoding, TiktokenModel } from 'js-tiktoken';
