// Preferred-model whitelist filtering. `preferred` entries in config are
// name SUBSTRING hints; they are matched against the live catalog and pruned
// when unavailable.

import type { Filtered } from "./filter.ts";
import type { RegistryModel } from "./types.ts";

/** Return models whose id/name matches at least one preferred substring. */
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

/** Registry-based preferred filtering for the local approved set. */
export function filterPreferredRegistry(models: RegistryModel[], preferred: string[]): RegistryModel[] {
  if (!preferred || preferred.length === 0) return models;
  const hints = preferred.map((p) => p.toLowerCase()).filter((p) => p.length > 0);
  if (hints.length === 0) return models;
  return models.filter((m) => {
    const id = m.id.toLowerCase();
    return hints.some((h) => id.includes(h));
  });
}
