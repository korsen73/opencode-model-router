// Discovery of the OpenRouter live model catalog.
// All HTTP goes through an injectable `fetch` so tests can mock it.

import { readJson, writeJson, now, readEnv } from "./io.ts";
import type { RouterConfig, CatalogModel, RegistryFile } from "./types.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface DiscoverOptions {
  fetchFn?: FetchLike;
  baseDir?: string;
}

const DEFAULT_HEADERS = {
  Accept: "application/json",
};

export async function fetchModels(
  config: RouterConfig,
  opts: DiscoverOptions = {},
): Promise<CatalogModel[]> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const apiKey = readEnv(config.discovery.apiKeyEnv);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.discovery.timeoutMs);
  try {
    const res = await fetchFn(config.discovery.url, {
      headers: {
        ...DEFAULT_HEADERS,
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`OpenRouter /models returned ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { data?: CatalogModel[] };
    if (!Array.isArray(json.data)) {
      throw new Error("OpenRouter /models response missing data[]");
    }
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

export interface DiscoverResult {
  models: CatalogModel[];
  fromCache: boolean;
}

/** Load catalog, refreshing if stale. Returns models plus a cache flag. */
export async function discoverModels(
  config: RouterConfig,
  opts: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const cache = await readJson<{ updatedAt: number; data: CatalogModel[] } | null>("models-cache.json", null);
  const maxAgeMs = config.discovery.refreshHours * 3600 * 1000;
  const fresh = cache && now() - cache.updatedAt < maxAgeMs;
  if (fresh && Array.isArray(cache.data)) {
    return { models: cache.data, fromCache: true };
  }
  try {
    const models = await fetchModels(config, opts);
    await writeJson("models-cache.json", { updatedAt: now(), data: models });
    return { models, fromCache: false };
  } catch (err) {
    // Fall back to a stale cache on API failure; caller decides staleness handling.
    if (cache && Array.isArray(cache.data)) {
      return { models: cache.data, fromCache: true };
    }
    throw err;
  }
}

/** Mark a discovered model stale in the persistent registry by id. */
export async function markStale(ids: string[]): Promise<void> {
  const reg = await readJson<RegistryFile>("models.json", {
    discovered: [],
    approved: [],
    disabled: [],
    updatedAt: 0,
  });
  const stale = new Set(ids);
  reg.discovered = reg.discovered.map((m) => (stale.has(m.id) ? { ...m, stale: true } : m));
  reg.updatedAt = now();
  await writeJson("models.json", reg);
}

export function isStaleCacheAge(cacheUpdatedAt: number, refreshHours: number): boolean {
  return now() - cacheUpdatedAt > refreshHours * 3600 * 1000;
}
