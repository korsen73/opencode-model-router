// Cost ceiling checks. All figures are ESTIMATES from catalog pricing;
// they are NOT official quota and are labeled as such.

import type { RouterConfig } from "./types.ts";

export interface CostInput {
  inputTokens: number;
  outputTokens: number;
  costInputPerM: number; // USD per 1M input tokens
  costOutputPerM: number; // USD per 1M output tokens
}

/** Estimate cost in USD for a token payload. Pure + testable. */
export function estimateCost(i: CostInput): number {
  const inputUSD = (i.inputTokens / 1_000_000) * i.costInputPerM;
  const outputUSD = (i.outputTokens / 1_000_000) * i.costOutputPerM;
  return inputUSD + outputUSD;
}

/** Does a request exceed the PAYG per-request cost ceiling? */
export function exceedsRequestCeiling(i: CostInput, cfg: RouterConfig): boolean {
  if (!cfg.payg.enabled) return true; // PAYG disabled => never allowed
  const cap = cfg.payg.maxCostPerRequestUSD;
  if (cap == null || cap < 0) return false;
  return estimateCost(i) > cap;
}

/** Does the provider's per-million rates exceed configured max rates? */
export function exceedsRateCeiling(
  costInputPerM: number,
  costOutputPerM: number,
  cfg: RouterConfig,
): boolean {
  const maxIn = cfg.payg.maxCostPerMillionInput;
  const maxOut = cfg.payg.maxCostPerMillionOutput;
  if (maxIn != null && costInputPerM > maxIn) return true;
  if (maxOut != null && costOutputPerM > maxOut) return true;
  return false;
}

/** Unknown quota: we never claim exact remaining quota; return null to signal unknown. */
export function isQuotaKnown(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
