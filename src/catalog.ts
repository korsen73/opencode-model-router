// Normalized Model Catalog: derives provider-independent capabilities and
// Artificial Analysis scores from the raw OpenRouter catalog. This is the
// source of truth for the capability-based Model Manager (the legacy
// classifyCapability in filter.ts remains as a fallback path).
//
// Scores (intelligence/coding/agentic) come ONLY from
// benchmarks.artificial_analysis. Missing scores stay null (never coerced to
// 0, never invented). Capabilities like coding/intelligence/agentic are NOT
// inferred from model id/name.

import type { CatalogModel, RegistryModel } from "./types.ts";

export interface NormalizedScores {
  intelligence: number | null;
  coding: number | null;
  agentic: number | null;
}

export interface NormalizedCapabilities {
  tools: boolean;
  reasoning: boolean;
  structured_outputs: boolean;
  input_modalities: string[];
  output_modalities: string[];
}

export interface NormalizedModel {
  isFree: boolean;
  context: number;
  scores: NormalizedScores;
  capabilities: NormalizedCapabilities;
}

function hasParam(m: CatalogModel, name: string): boolean {
  return (m.supported_parameters ?? []).includes(name);
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

function isFreeByPricing(m: CatalogModel): boolean {
  const p = m.pricing ?? {};
  return numOrNull(p.prompt) === 0 && numOrNull(p.completion) === 0;
}

function mods(arr: string[] | undefined): string[] {
  return (arr ?? []).map((x) => String(x).toLowerCase());
}

/** Normalize a raw OpenRouter catalog model into provider-independent form. */
export function normalizeModel(m: CatalogModel): NormalizedModel {
  const aa = m.benchmarks?.artificial_analysis ?? {};
  const arch = m.architecture ?? {};
  return {
    isFree: isFreeByPricing(m),
    context: typeof m.context_length === "number" ? m.context_length : (m.context_length ?? 0),
    scores: {
      intelligence: numOrNull(aa.intelligence_index),
      coding: numOrNull(aa.coding_index),
      agentic: numOrNull(aa.agentic_index),
    },
    capabilities: {
      tools: hasParam(m, "tools"),
      reasoning: hasParam(m, "reasoning") || m.reasoning != null,
      structured_outputs: hasParam(m, "structured_outputs"),
      input_modalities: mods(arch.input_modalities),
      output_modalities: mods(arch.output_modalities),
    },
  };
}

/** Attach normalized data + raw metadata to a registry entry. */
export function enrichRegistryModel(m: RegistryModel, raw: CatalogModel): RegistryModel {
  const n = normalizeModel(raw);
  return {
    ...m,
    isFree: n.isFree,
    context: n.context,
    tools: n.capabilities.tools,
    scores: n.scores,
    normalizedCapabilities: n.capabilities,
    metadata: {
      canonical_slug: raw.canonical_slug,
      name: raw.name,
      description: raw.description,
      created: raw.created,
      expiration_date: raw.expiration_date,
      top_provider: raw.top_provider,
      reasoning: raw.reasoning,
      architecture: raw.architecture,
    },
  };
}
