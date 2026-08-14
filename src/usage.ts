// Locally-tracked usage counters per provider.
// IMPORTANT: these are LOCALLY-OBSERVED estimates, NOT official quota.
// Support daily reset using the local system timezone.

import { readJson, writeJson, now, localDayKey } from "./io.ts";
import type { RouterConfig, UsageFile } from "./types.ts";

export interface UsageUpdate {
  provider: string; // Tier label key
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
}

export function defaultUsageFile(resetKey: string): UsageFile {
  return {
    resetKey,
    providers: {},
    lastUpdated: now(),
  };
}

export async function loadUsage(config: RouterConfig): Promise<UsageFile> {
  const key = localDayKey(config.dailyReset);
  const f = await readJson<UsageFile | null>("usage.json", null);
  if (!f || typeof f !== "object") return defaultUsageFile(key);
  if (f.resetKey !== key) {
    // New day: reset counters.
    return defaultUsageFile(key);
  }
  return f;
}

export async function recordUsage(config: RouterConfig, u: UsageUpdate): Promise<UsageFile> {
  const f = await loadUsage(config);
  const cur = f.providers[u.provider] ?? {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUSD: 0,
  };
  cur.requests += 1;
  cur.inputTokens += u.inputTokens;
  cur.outputTokens += u.outputTokens;
  cur.estimatedCostUSD += u.estimatedCostUSD;
  f.providers[u.provider] = cur;
  f.lastUpdated = now();
  await writeJson("usage.json", f);
  return f;
}

export async function resetUsage(config: RouterConfig): Promise<UsageFile> {
  const f = defaultUsageFile(localDayKey(config.dailyReset));
  await writeJson("usage.json", f);
  return f;
}
