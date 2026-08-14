// Filtering: Free-model detection from ACTUAL pricing fields, capability
// classification from metadata, and quality-floor enforcement.
// IMPORTANT: Free is determined by pricing (prompt===0 && completion===0),
// never by guessing from the model name/`:free` suffix (though we keep the
// suffix as a secondary hint only for logging).

import type { CatalogModel, Capability, RouterConfig } from "./types.ts";

export interface Filtered {
  model: CatalogModel;
  isFree: boolean;
  capability: Capability;
  context: number;
  tools: boolean;
  costInput: number;
  costOutput: number;
}

/** Determine Free status purely from pricing fields. 0/undefined == 0 cost.
 *  NOTE: the live OpenRouter API returns pricing as STRINGS ("0"), so we
 *  coerce numeric strings before comparing. */
export function isFreeByPricing(m: CatalogModel): boolean {
  const p = m.pricing ?? {};
  const num = (v: number | string | undefined): number => {
    if (v == null || v === "") return 0;
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : 0;
  };
  return num(p.prompt) === 0 && num(p.completion) === 0 && num(p.request) === 0;
}

export function classifyCapability(m: CatalogModel): Capability {
  const id = (m.id ?? "").toLowerCase();
  const name = (m.name ?? "").toLowerCase();
  const mods = [
    ...(m.architecture?.input_modalities ?? []),
    ...(m.architecture?.output_modalities ?? []),
    ...(m.architecture?.modality ? [m.architecture.modality] : []),
  ].map((x) => x.toLowerCase());

  const supportsTools = (m.supported_parameters ?? []).includes("tools");

  // ---- Coding signal (explicit, checked FIRST, before reasoning) ----
  // A strong, metadata-driven (id/name substring) code indicator. This must
  // run before the reasoning branch so coding models like
  // `cohere/north-mini-code:free` are correctly classified as coding instead
  // of being swallowed by the greedy reasoning heuristic.
  const CODE_HINTS = [
    "code",
    "coder",
    "codex",
    "-code",
    "coding",
    "code-savvy",
    "dev",
    "north-mini-code",
  ];
  const hasCodingSignal = CODE_HINTS.some((h) => id.includes(h) || name.includes(h));

  // ---- Reasoning signal ----
  // `supported_parameters` includes "reasoning" on nearly every model (it is a
  // capability flag, not a specialization), so do NOT treat it as a strong
  // signal. Rely on genuine id/name reasoning indicators only.
  const idName = `${id} ${name}`;
  const hasReasoningSignal =
    idName.includes("reasoning") ||
    idName.includes(" think") ||
    idName.includes("think-") ||
    idName.includes("-think") ||
    idName.includes("r1") ||
    idName.includes("-r1-");

  const isMultimodal = mods.some((x) => x === "image" || x === "video" || x === "audio");

  // Coding takes precedence over reasoning when a strong coding signal exists,
  // even if the model is multimodal (e.g. a vision+code model). If there is a
  // strong contrary reasoning signal AND no multimodal, we still prefer coding
  // only when the code signal is unambiguous; ambiguous cases fall through.
  if (hasCodingSignal) {
    return "coding";
  }

  if (isMultimodal) {
    return "general"; // multimodal => general-purpose, not specialized
  }

  if (hasReasoningSignal && supportsTools) {
    return "reasoning";
  }

  if (supportsTools) {
    return "coding";
  }

  // Unknown capability, explicitly marked unknown rather than guessed.
  return "unknown";
}

function contextOf(m: CatalogModel): number {
  return m.context_length ?? 0;
}

export function passesQualityFloor(m: CatalogModel, config: RouterConfig): boolean {
  const ctx = contextOf(m);
  if (ctx > 0 && ctx < config.qualityFloor.minContext) return false;
  if (config.qualityFloor.tools && !(m.supported_parameters ?? []).includes("tools")) return false;
  return true;
}

/** Full filter: returns structured metadata or null if it fails the floor. */
export function filterModel(m: CatalogModel, config: RouterConfig): Filtered | null {
  if (!passesQualityFloor(m, config)) return null;
  const num = (v: number | string | undefined): number =>
    v == null || v === "" ? 0 : Number.isFinite(Number(v)) ? Number(v) : 0;
  return {
    model: m,
    isFree: isFreeByPricing(m),
    capability: classifyCapability(m),
    context: contextOf(m),
    tools: (m.supported_parameters ?? []).includes("tools"),
    costInput: num(m.pricing?.prompt),
    costOutput: num(m.pricing?.completion),
  };
}

/** Does a model pass the per-capability minimums? */
export function passesCapabilityFloor(f: Filtered, cap: Capability, config: RouterConfig): boolean {
  const c = config.capabilities[cap];
  if (!c) return true; // no floor defined
  if (f.context > 0 && f.context < c.minContext) return false;
  if (c.tools && !f.tools) return false;
  return true;
}

/** Preferred-model whitelist filter (substring hints on id/name). */
export function filterPreferred(models: Filtered[], preferred: string[]): Filtered[] {
  if (!preferred || preferred.length === 0) return models;
  const hints = preferred.map((p) => p.toLowerCase()).filter((p) => p.length > 0);
  if (hints.length === 0) return models;
  return models.filter((m) => {
    const id = (m.model.id ?? "").toLowerCase();
    const name = (m.model.name ?? "").toLowerCase();
    return hints.some((h) => id.includes(h) || name.includes(h));
  });
}
