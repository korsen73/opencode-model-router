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
// Candidate chain capacity: primary + up to 3 real fallbacks. OpenRouter caps
// the injected models[] array at OPENROUTER_MODELS_MAX (3), and the plugin
// removes the primary before injection, so the candidate chain may hold
// OPENROUTER_MODELS_MAX + 1 = 4 (the primary + 3 non-primary fallbacks). This
// ensures the injected array can still carry 3 real fallbacks after the
// primary is excluded.
export const CANDIDATE_CHAIN_MAX = OPENROUTER_MODELS_MAX + 1;

export interface RandomizeOptions {
  enabled: boolean;
  maxChain: number;
}

export interface RandomizedChain {
  models: Filtered[];
  truncated: boolean;
}

/**
 * Build a candidate Free chain. If randomization is enabled, the whole free
 * pool is Fisher-Yates shuffled (unbiased, no duplicates) before being
 * truncated. The chain may hold up to CANDIDATE_CHAIN_MAX (4) = the primary
 * plus up to 3 real fallbacks. The plugin excludes the primary and clamps the
 * INJECTED models[] array to OPENROUTER_MODELS_MAX (3), OpenRouter's server-
 * side limit.
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

  // Candidate chain capacity: allow primary + fallbacks, but never exceed the
  // hard ceiling. The injected models[] array is capped separately (to
  // OPENROUTER_MODELS_MAX) by the plugin after removing the primary.
  const cap = Math.min(opts.maxChain + 1, CANDIDATE_CHAIN_MAX);
  const truncated = deduped.length > cap;
  return {
    models: deduped.slice(0, cap),
    truncated,
  };
}

/**
 * Build the INJECTED OpenRouter `models[]` fallback array from a candidate
 * chain. OpenRouter tries the primary `model` field first, then this array in
 * order as fallbacks. To avoid wasting a slot on the model OpenRouter already
 * tries as the primary, the primary is excluded. The result is clamped to
 * OPENROUTER_MODELS_MAX (3) and deduplicated.
 */
export function buildInjectedFallbacks(chain: string[], primary?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of chain) {
    if (primary && id === primary) continue; // skip the request primary
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= OPENROUTER_MODELS_MAX) break;
  }
  return out;
}

/** Count distribution check helper for tests: returns an array of picks. */
export function pickOneWeighted<T>(items: T[], rng: () => number): T {
  const i = Math.floor(rng() * items.length);
  return items[i] as T;
}
