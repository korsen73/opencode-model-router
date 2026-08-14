// Capability classification with a manual local override file.
// `classify.ts` combines automatic classification (from filter.ts) with an
// explicit per-model override map so a user can force capabilities for models
// whose metadata is insufficient (kept as `unknown` otherwise).

import { readJson } from "./io.ts";
import type { Capability } from "./types.ts";
import { classifyCapability } from "./filter.ts";
import type { CatalogModel } from "./types.ts";

const OVERRIDE_FILE = "classify-overrides.json";

export interface ClassifyOverrides {
  [modelID: string]: Capability;
}

export async function loadOverrides(): Promise<ClassifyOverrides> {
  return readJson<ClassifyOverrides>(OVERRIDE_FILE, {});
}

/** Classify a model using override first, then automatic heuristics. */
export async function classify(m: CatalogModel): Promise<Capability> {
  const overrides = await loadOverrides();
  if (m.id && overrides[m.id]) return overrides[m.id] as Capability;
  return classifyCapability(m);
}

/** Pure (sync) variant for unit tests; uses overrides directly. */
export function classifyWithOverrides(m: CatalogModel, overrides: ClassifyOverrides): Capability {
  if (m.id && overrides[m.id]) return overrides[m.id] as Capability;
  return classifyCapability(m);
}
