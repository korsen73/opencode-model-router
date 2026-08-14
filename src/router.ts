// Router orchestrator entrypoint. Also provides a CLI with subcommands:
//   status, refresh-models, diagnostics, decide <agent>
//
// This is the pure logic layer. The plugin (plugins/router-plugin.ts) imports
// from here to inject the computed chain into requests and to log usage.

import { readJson, writeJson, now, iso } from "./io.ts";
import { discoverModels, fetchModels, markStale, type FetchLike } from "./discover.ts";
import { filterModel, filterPreferred as filterByCap, type Filtered } from "./filter.ts";
import { classifyWithOverrides } from "./classify.ts";
import { enrichRegistryModel } from "./catalog.ts";
import { decideProvider } from "./fallback.ts";
import { loadHealth, saveHealth, defaultHealthFile, effectiveState } from "./health.ts";
import { recordUsage } from "./usage.ts";
import { logRouting } from "./log.ts";
import type {
  Capability,
  CatalogModel,
  Decision,
  HealthState,
  RegistryFile,
  RegistryModel,
  RouterConfig,
  Tier,
  UsageFile,
} from "./types.ts";

export interface Loaded {
  config: RouterConfig;
  registry: RegistryFile;
}

export async function loadConfig(): Promise<RouterConfig> {
  return readJson<RouterConfig>("config.json", null as unknown as RouterConfig);
}

export async function loadRegistry(): Promise<RegistryFile> {
  return readJson<RegistryFile>("models.json", {
    discovered: [],
    approved: [],
    disabled: [],
    updatedAt: 0,
  });
}

/** Merge live catalog into the persistent registry, classifying each model. */
export async function refreshModels(
  config: RouterConfig,
  fetchFn?: FetchLike,
): Promise<{ count: number; added: number; fromCache: boolean }> {
  const { models, fromCache } = await discoverModels(config, { fetchFn });
  const reg = await loadRegistry();
  const overrides = await loadOverrides();
  const existing = new Map(reg.discovered.map((m) => [m.id, m]));
  let added = 0;

  for (const cm of models) {
    const f = filterModel(cm, config);
    if (!f) continue;
    if (!existing.has(cm.id)) {
      const base: RegistryModel = {
        id: cm.id,
        providerID: "openrouter",
        isFree: f.isFree,
        capability: classifyWithOverrides(cm, overrides),
        context: f.context,
        tools: f.tools,
        costInput: f.costInput,
        costOutput: f.costOutput,
        status: "discovered",
        stale: false,
        discoveredAt: now(),
      };
      reg.discovered.push(enrichRegistryModel(base, cm));
      added++;
    } else {
      // Re-enrich existing entries so raw metadata + normalized scores are
      // refreshed on each catalog refresh (in case OpenRouter updated them).
      const i = reg.discovered.findIndex((m) => m.id === cm.id);
      if (i >= 0) {
        reg.discovered[i] = enrichRegistryModel(reg.discovered[i] as RegistryModel, cm);
      }
    }
  }

  // Mark previously-known models not seen as stale.
  const live = new Set(models.map((m) => m.id));
  reg.discovered = reg.discovered.map((m) => ({ ...m, stale: !live.has(m.id) }));
  reg.updatedAt = now();
  await writeJson("models.json", reg);
  return { count: reg.discovered.length, added, fromCache };
}

export async function loadOverrides(): Promise<Record<string, Capability>> {
  return readJson<Record<string, Capability>>("classify-overrides.json", {});
}

/** Build the Free + approved candidate pool for an agent's capability. */
export async function candidatePool(
  config: RouterConfig,
  registry: RegistryFile,
  agent: string,
): Promise<{ pool: Filtered[]; capability: Capability }> {
  const capRaw = config.agentCapability[agent] ?? "unknown";
  const capability = (["coding", "reasoning", "general", "chat"].includes(capRaw)
    ? capRaw
    : "unknown") as Capability;

  // Reconstruct Filtered from registry entries (registry is the source of truth).
  const META_ROUTING_IDS = new Set(["openrouter/free", "openrouter/auto", "openrouter:routed", "openrouter/routed"]);
  const pool: Filtered[] = registry.discovered
    .filter((r) => r.status === "approved" || r.status === "discovered")
    .filter((r) => !r.stale)
    .filter((r) => !META_ROUTING_IDS.has(r.id))
    .filter((r) => r.capability === capability || capability === "general" || r.capability === "general")
    .map((r) => ({
      model: { id: r.id, name: r.id, pricing: { prompt: r.costInput, completion: r.costOutput } },
      isFree: r.isFree,
      capability: r.capability,
      context: r.context,
      tools: r.tools,
      costInput: r.costInput,
      costOutput: r.costOutput,
    }))
    .filter((f) => f.isFree); // router focuses on Free selection

  // Apply preferred-model whitelist for this capability.
  const preferred = config.capabilities[capability]?.preferred ?? [];
  const preferredPool = filterByCap(pool, preferred);
  return { pool: preferredPool.length > 0 ? preferredPool : pool, capability };
}

/** Compute a routing decision for an agent. */
export async function decide(
  config: RouterConfig,
  agent: string,
  opts: { fetchFn?: FetchLike } = {},
): Promise<Decision> {
  const registry = await loadRegistry();
  const health = await loadHealth();

  // Seed health defaults from config for providers not yet recorded.
  for (const [tierKey, state] of Object.entries(config.providerHealth)) {
    const providerID = config.providers[tierKey as Tier]?.providerID;
    if (providerID && !health.providers[providerID]) {
      health.providers[providerID] = { state, lastCheckedAt: now() };
    }
  }
  await saveHealth(health);

  const { pool, capability } = await candidatePool(config, registry, agent);

  const healthMap: Record<string, HealthState> = {};
  for (const tier of config.providerOrder) {
    const key = config.providers[tier].providerID;
    healthMap[key] = effectiveState(health, key, now());
  }

  const decision = decideProvider(
    {
      agent,
      capability,
      freePool: pool,
      health: {
        free: healthMap[config.providers["free"].providerID] ?? "UNKNOWN",
        "opencode-go": healthMap[config.providers["opencode-go"].providerID] ?? "UNKNOWN",
        "deepseek/zai": healthMap[config.providers["deepseek/zai"].providerID] ?? "UNKNOWN",
        payg: healthMap[config.providers["payg"].providerID] ?? "UNKNOWN",
      },
      randomizeEnabled: config.randomizeFreeModels,
      maxFreePerChain: config.maxFreeModelsPerChain,
    },
    config,
  );

  await logRouting({
    timestamp: iso(),
    agent,
    capability,
    selectedProvider: decision.provider,
    selectedModel: decision.model,
    chain: decision.chain,
    reason: decision.reason,
    estimatedCostUSD: decision.estimatedCostUSD,
    isFree: decision.isFree,
    didFallback: decision.didFallback,
  });

  return decision;
}

/** Resolve an agent's capability string to a valid Capability. */
function capabilityOf(config: RouterConfig, agent: string): Capability {
  const capRaw = config.agentCapability[agent] ?? "unknown";
  return (["coding", "reasoning", "general", "chat"].includes(capRaw) ? capRaw : "unknown") as Capability;
}

/**
 * Compute the current top Free model ID for a capability, using the same
 * candidatePool/decideProvider logic as `decide`. Used to build stable virtual
 * routing models (`openrouter/free-<capability>`) whose `api.id` tracks the
 * live catalog. Returns null if no suitable Free model is available.
 */
export async function topFreePickForCapability(
  config: RouterConfig,
  capability: Capability,
): Promise<string | null> {
  const registry = await loadRegistry();
  const health = await loadHealth();
  // Seed defaults so a fresh install doesn't read all-UNKNOWN.
  for (const [tierKey, state] of Object.entries(config.providerHealth)) {
    const providerID = config.providers[tierKey as Tier]?.providerID;
    if (providerID && !health.providers[providerID]) {
      health.providers[providerID] = { state, lastCheckedAt: now() };
    }
  }

  // Build a pool directly for the capability (no agent coupling).
  const META_ROUTING_IDS = new Set(["openrouter/free", "openrouter/auto", "openrouter:routed", "openrouter/routed"]);
  const pool: Filtered[] = registry.discovered
    .filter((r) => r.status === "approved" || r.status === "discovered")
    .filter((r) => !r.stale)
    .filter((r) => !META_ROUTING_IDS.has(r.id))
    .filter((r) => r.capability === capability || capability === "general" || r.capability === "general")
    .map((r) => ({
      model: { id: r.id, name: r.id, pricing: { prompt: r.costInput, completion: r.costOutput } },
      isFree: r.isFree,
      capability: r.capability,
      context: r.context,
      tools: r.tools,
      costInput: r.costInput,
      costOutput: r.costOutput,
    }))
    .filter((f) => f.isFree);

  const preferred = config.capabilities[capability]?.preferred ?? [];
  const preferredPool = filterByCap(pool, preferred);
  const freePool = preferredPool.length > 0 ? preferredPool : pool;

  const decision = decideProvider(
    {
      agent: capability,
      capability,
      freePool,
      health: {
        free: health.providers[config.providers["free"].providerID]?.state ?? "UNKNOWN",
        "opencode-go": health.providers[config.providers["opencode-go"].providerID]?.state ?? "UNKNOWN",
        "deepseek/zai": health.providers[config.providers["deepseek/zai"].providerID]?.state ?? "UNKNOWN",
        payg: health.providers[config.providers["payg"].providerID]?.state ?? "UNKNOWN",
      },
      randomizeEnabled: config.randomizeFreeModels,
      maxFreePerChain: config.maxFreeModelsPerChain,
    },
    config,
  );

  if (decision.provider === "free" && decision.model) return decision.model;
  return null;
}

export async function statusReport(): Promise<object> {
  const config = await loadConfig();
  const registry = await loadRegistry();
  const health = await loadHealth();
  return {
    version: config.version,
    providerOrder: config.providerOrder,
    providers: health.providers,
    discovered: registry.discovered.length,
    approved: registry.approved.length,
    disabled: registry.disabled.length,
    stale: registry.discovered.filter((m) => m.stale).length,
  };
}

export async function diagnostics(fetchFn?: FetchLike): Promise<object> {
  const config = await loadConfig();
  const reg = await loadRegistry();
  const out: Record<string, unknown> = {
    time: iso(),
    configVersion: config.version,
    randomize: config.randomizeFreeModels,
    maxFreePerChain: config.maxFreeModelsPerChain,
    paygEnabled: config.payg.enabled,
    discoveredModels: reg.discovered.length,
  };
  try {
    const fresh = await discoverModels(config, { fetchFn });
    out.catalogProbe = { ok: true, count: fresh.models.length, fromCache: fresh.fromCache };
  } catch (err) {
    out.catalogProbe = { ok: false, error: (err as Error).message };
  }
  return out;
}

export { recordUsage };
