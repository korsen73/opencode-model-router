// Randomization of the Free-model chain using an unbiased Fisher-Yates shuffle.
// Configurable on/off, plus a max chain length.

import { shuffle } from "./io.ts";
export { shuffle };
import type { Filtered } from "./filter.ts";

/**
 * HARD safety invariant: OpenRouter's native `models` fallback array accepts
 * AT MOST 3 items (live-verified: a 4-item chain returned HTTP 400
 * "'models' array must have 3 items or fewer."). This constant is the
 * authoritative ceiling regardless of config, so a future config edit above 3
 * can never produce a rejected request.
 */
export const OPENROUTER_MODELS_MAX = 3;

export interface RandomizeOptions {
  enabled: boolean;
  maxChain: number;
}

export interface RandomizedChain {
  models: Filtered[];
  truncated: boolean;
}

/**
 * Build a Free chain. If randomization is enabled, the whole free pool is
 * Fisher-Yates shuffled (unbiased, no duplicates) before being truncated.
 * The final chain length is ALWAYS clamped to OPENROUTER_MODELS_MAX (3),
 * regardless of `opts.maxChain`, as a defensive invariant against
 * OpenRouter's server-side limit.
 */
export function buildFreeChain(pool: Filtered[], opts: RandomizeOptions): RandomizedChain {
  // Deduplicate by model id first.
  const seen = new Set<string>();
  const deduped = pool.filter((m) => {
    const k = m.model.id ?? "";
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (opts.enabled) {
    shuffle(deduped);
  }

  // Clamp to the hard OpenRouter limit (defensive, config-independent).
  const cap = Math.min(opts.maxChain, OPENROUTER_MODELS_MAX);
  const truncated = deduped.length > cap;
  return {
    models: deduped.slice(0, cap),
    truncated,
  };
}

/** Count distribution check helper for tests: returns an array of picks. */
export function pickOneWeighted<T>(items: T[], rng: () => number): T {
  const i = Math.floor(rng() * items.length);
  return items[i] as T;
}
