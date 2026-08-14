// Capability-based Model Manager (Step 2).
//
// Selects models from the normalized catalog by routing CLASS (manager,
// coding, reasoning, coding_agent) using OFFICIAL Artificial Analysis scores,
// NOT model names. Ranking is deterministic; selection is availability-aware
// (endpoint uptime) with a CONTROLLED randomization of the fallback order for
// diversity. The primary is always the best healthy model by ranking.

import type { RegistryModel, RouterConfig, RoutingClass } from "./types.ts";

export const ROUTING_CLASSES: RoutingClass[] = ["manager", "coding", "reasoning", "coding_agent"];

export interface Top4 {
  cls: RoutingClass;
  primary: RegistryModel | null;
  fallbacks: RegistryModel[]; // up to 3
}

export interface RankableModel {
  model: RegistryModel;
  intelligence: number | null;
  coding: number | null;
  agentic: number | null;
  tools: boolean;
  reasoning: boolean;
  context: number;
}

function score(v: number | null | undefined): number {
  return v == null ? -1 : v;
}

/** Build a rankable wrapper; models without any relevant score are rankable=false. */
function toRankable(m: RegistryModel): RankableModel {
  const s = m.scores ?? { intelligence: null, coding: null, agentic: null };
  return {
    model: m,
    intelligence: s.intelligence,
    coding: s.coding,
    agentic: s.agentic,
    tools: m.normalizedCapabilities?.tools ?? m.tools,
    reasoning: m.normalizedCapabilities?.reasoning ?? false,
    context: m.context,
  };
}

/** Comparator for a routing class. Deterministic: score keys desc, then stable id asc. */
function comparator(cls: RoutingClass) {
  const byId = (a: RankableModel, b: RankableModel) => (a.model.id < b.model.id ? -1 : a.model.id > b.model.id ? 1 : 0);
  switch (cls) {
    case "coding":
      return (a: RankableModel, b: RankableModel) =>
        score(b.coding) - score(a.coding) ||
        (b.tools ? 1 : 0) - (a.tools ? 1 : 0) ||
        (b.context - a.context) ||
        byId(a, b);
    case "coding_agent":
      return (a: RankableModel, b: RankableModel) =>
        score(b.agentic) - score(a.agentic) ||
        score(b.coding) - score(a.coding) ||
        (b.tools ? 1 : 0) - (a.tools ? 1 : 0) ||
        (b.context - a.context) ||
        byId(a, b);
    case "reasoning":
      return (a: RankableModel, b: RankableModel) =>
        score(b.intelligence) - score(a.intelligence) ||
        (b.reasoning ? 1 : 0) - (a.reasoning ? 1 : 0) ||
        (b.context - a.context) ||
        byId(a, b);
    case "manager":
    default:
      return (a: RankableModel, b: RankableModel) =>
        score(b.intelligence) - score(a.intelligence) ||
        (b.tools ? 1 : 0) - (a.tools ? 1 : 0) ||
        (b.context - a.context) ||
        byId(a, b);
  }
}

/** Whether a model is even eligible for a routing class (has the required score). */
function eligible(m: RankableModel, cls: RoutingClass): boolean {
  switch (cls) {
    case "coding":
      return m.coding != null;
    case "coding_agent":
      return m.agentic != null || m.coding != null;
    case "reasoning":
      return m.intelligence != null;
    case "manager":
    default:
      return m.intelligence != null;
  }
}

/** Deterministic ranking of registry models for a routing class. */
export function rankForClass(models: RegistryModel[], cls: RoutingClass): RankableModel[] {
  return models
    .map(toRankable)
    .filter((m) => eligible(m, cls))
    .sort(comparator(cls));
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]! as T, a[i]! as T];
  }
  return a;
}

/**
 * Select Top N for a routing class.
 * @param healthyIds  Set of model ids considered healthy (uptime >= threshold). null => skip health filtering.
 * @param randomizeFallbacks  If true, randomize the order of the FALLBACKS (primary stays deterministic).
 */
export function selectTop4(
  models: RegistryModel[],
  cls: RoutingClass,
  topK: number,
  healthyIds: Set<string> | null,
  randomizeFallbacks: boolean,
): Top4 {
  const ranked = rankForClass(models, cls);
  // Availability filter: models in healthyIds are preferred and moved to the
  // front (deterministic ranking preserved within each group). Models without
  // health data are treated as healthy so we never starve the pool.
  let pool = ranked;
  if (healthyIds) {
    pool = ranked
      .filter((r) => healthyIds.has(r.model.id))
      .concat(ranked.filter((r) => !healthyIds.has(r.model.id)));
  }
  const n = Math.min(topK, pool.length);
  const chosen = pool.slice(0, n);
  if (chosen.length === 0) return { cls, primary: null, fallbacks: [] };
  const primary = chosen[0]!.model;
  let fallbacks = chosen.slice(1).map((r) => r.model);
  if (randomizeFallbacks && fallbacks.length > 1) {
    fallbacks = shuffle(fallbacks);
  }
  return { cls, primary, fallbacks: fallbacks.slice(0, 3) };
}

/** Resolve the routing class for an agent from config (defaults to manager). */
export function classForAgent(config: RouterConfig, agent: string): RoutingClass {
  const c = config.agentClass?.[agent];
  return (c && ROUTING_CLASSES.includes(c)) ? c : "manager";
}
