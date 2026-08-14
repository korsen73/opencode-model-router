// Provider and model health tracking with cooldowns.
// States: AVAILABLE / TEMPORARILY_UNAVAILABLE / EXHAUSTED / DISABLED /
// CONFIGURATION_ERROR / UNKNOWN.

import { readJson, writeJson, now } from "./io.ts";
import type { HealthFile, HealthState, ProviderHealth } from "./types.ts";

export interface CooldownCtx {
  cooldownSeconds: number;
}

export function defaultHealthFile(): HealthFile {
  return { providers: {}, models: {}, endpoints: {}, updatedAt: now() };
}

export async function loadHealth(): Promise<HealthFile> {
  const f = await readJson<HealthFile | null>("status.json", null);
  if (!f || typeof f !== "object") return defaultHealthFile();
  return {
    providers: f.providers ?? {},
    models: f.models ?? {},
    endpoints: f.endpoints ?? {},
    updatedAt: f.updatedAt ?? now(),
  };
}

export async function saveHealth(f: HealthFile): Promise<void> {
  f.updatedAt = now();
  await writeJson("status.json", f);
}

export function getProviderState(h: HealthFile, provider: string): HealthState {
  return h.providers[provider]?.state ?? "UNKNOWN";
}

/** Apply a cooldown to a provider, setting its state to TEMPORARILY_UNAVAILABLE. */
export async function setCooldown(provider: string, seconds: number, reason?: string): Promise<void> {
  const h = await loadHealth();
  const until = now() + seconds * 1000;
  h.providers[provider] = {
    state: "TEMPORARILY_UNAVAILABLE",
    reason: reason ?? "cooldown",
    lastCheckedAt: now(),
    cooldownUntil: until,
  };
  await saveHealth(h);
}

/** Clear a cooldown. Returns true if there was one to clear. */
export async function clearCooldown(provider: string): Promise<boolean> {
  const h = await loadHealth();
  const p = h.providers[provider];
  if (p && p.cooldownUntil) {
    delete h.providers[provider];
    await saveHealth(h);
    return true;
  }
  return false;
}

/** Effective state honoring cooldown expiry. */
export function effectiveState(h: HealthFile, provider: string, nowMs: number): HealthState {
  const p = h.providers[provider];
  if (!p) return "UNKNOWN";
  if (p.cooldownUntil && nowMs < p.cooldownUntil) return "TEMPORARILY_UNAVAILABLE";
  return p.state;
}

/** Update a provider's state directly. */
export async function setProviderState(provider: string, state: HealthState, reason?: string): Promise<void> {
  const h = await loadHealth();
  h.providers[provider] = {
    state,
    reason,
    lastCheckedAt: now(),
  };
  await saveHealth(h);
}

export function isCooldownActive(h: HealthFile, provider: string, nowMs: number, cooldownCtx: CooldownCtx): boolean {
  const p = h.providers[provider];
  if (!p?.cooldownUntil) return false;
  return nowMs < p.cooldownUntil;
}

// ---------------------------------------------------------------------------
// Endpoint health (dynamic, per-model, TTL-cached)
// ---------------------------------------------------------------------------

import type { FetchLike } from "./discover.ts";
import type { EndpointInfo, RouterConfig } from "./types.ts";

const ENDPOINT_BASE = "https://openrouter.ai/api/v1/models";

/** Build the endpoints URL for a model id like "nvidia/model:free". */
export function endpointsUrl(modelId: string): string {
  const slash = modelId.indexOf("/");
  if (slash < 0) return `${ENDPOINT_BASE}/${encodeURIComponent(modelId)}/endpoints`;
  const author = modelId.slice(0, slash);
  const slug = modelId.slice(slash + 1);
  // Slash between author/slug NOT encoded; slug may contain ':' (kept literal).
  return `${ENDPOINT_BASE}/${author}/${slug}/endpoints`;
}

/** Fetch + parse endpoint health for a model. Returns parsed endpoints. */
export async function fetchEndpoints(
  modelId: string,
  config: RouterConfig,
  fetchFn?: FetchLike,
): Promise<EndpointInfo[]> {
  const f = fetchFn ?? globalThis.fetch;
  const apiKey = process.env[config.discovery.apiKeyEnv] ?? process.env[config.discovery.apiKeyEnv];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.discovery.timeoutMs);
  try {
    const res = await f(endpointsUrl(modelId), {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`OpenRouter /endpoints returned ${res.status} ${res.statusText} for ${modelId}`);
    }
    const json = (await res.json()) as { data?: { endpoints?: EndpointInfo[] } };
    return (json.data?.endpoints ?? []).map((e) => ({
      provider_name: e.provider_name,
      status: e.status ?? null,
      uptime_last_5m: e.uptime_last_5m ?? null,
      uptime_last_30m: e.uptime_last_30m ?? null,
      uptime_last_1d: e.uptime_last_1d ?? null,
      latency_last_30m: e.latency_last_30m ?? null,
      throughput_last_30m: e.throughput_last_30m ?? null,
    }));
  } finally {
    clearTimeout(timer);
  }
}

/** Get cached endpoint health for a model, refreshing if the TTL has lapsed. */
export async function getEndpointHealth(
  modelId: string,
  config: RouterConfig,
  fetchFn?: FetchLike,
): Promise<{ endpoints: EndpointInfo[]; cached: boolean }> {
  const h = await loadHealth();
  const entry = h.endpoints?.[modelId];
  const ttlMs = config.endpointHealthTtlSeconds * 1000;
  if (entry && entry.endpoints.length > 0 && now() - entry.fetchedAt < ttlMs) {
    return { endpoints: entry.endpoints, cached: true };
  }
  try {
    const endpoints = await fetchEndpoints(modelId, config, fetchFn);
    h.endpoints = h.endpoints ?? {};
    h.endpoints[modelId] = { endpoints, fetchedAt: now() };
    await saveHealth(h);
    return { endpoints, cached: false };
  } catch (err) {
    // On failure, return stale cached data if present.
    if (entry && entry.endpoints.length > 0) {
      return { endpoints: entry.endpoints, cached: true };
    }
    throw err;
  }
}

/** Best endpoint health signal (uptime_last_5m) across a model's endpoints. */
export function bestUptime5m(endpoints: EndpointInfo[]): number | null {
  let best: number | null = null;
  for (const e of endpoints) {
    const u = e.uptime_last_5m;
    if (u == null) continue;
    if (best == null || u > best) best = u;
  }
  return best;
}
