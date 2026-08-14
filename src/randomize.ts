// Randomization of the Free-model chain using an unbiased Fisher-Yates shuffle.
// Configurable on/off, plus a max chain length.

import { shuffle } from "./io.ts";
export { shuffle };
import type { Filtered } from "./filter.ts";

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
 * Fisher-Yates shuffled (unbiased, no duplicates) before being truncated to
 * maxChain. Returns the chosen (possibly shuffled, always deduped) subset.
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

  const truncated = deduped.length > opts.maxChain;
  return {
    models: deduped.slice(0, opts.maxChain),
    truncated,
  };
}

/** Count distribution check helper for tests: returns an array of picks. */
export function pickOneWeighted<T>(items: T[], rng: () => number): T {
  const i = Math.floor(rng() * items.length);
  return items[i] as T;
}
