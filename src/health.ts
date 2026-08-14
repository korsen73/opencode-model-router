// Provider and model health tracking with cooldowns.
// States: AVAILABLE / TEMPORARILY_UNAVAILABLE / EXHAUSTED / DISABLED /
// CONFIGURATION_ERROR / UNKNOWN.

import { readJson, writeJson, now } from "./io.ts";
import type { HealthFile, HealthState, ProviderHealth } from "./types.ts";

export interface CooldownCtx {
  cooldownSeconds: number;
}

export function defaultHealthFile(): HealthFile {
  return { providers: {}, models: {}, updatedAt: now() };
}

export async function loadHealth(): Promise<HealthFile> {
  const f = await readJson<HealthFile | null>("status.json", null);
  if (!f || typeof f !== "object") return defaultHealthFile();
  return { providers: f.providers ?? {}, models: f.models ?? {}, updatedAt: f.updatedAt ?? now() };
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
