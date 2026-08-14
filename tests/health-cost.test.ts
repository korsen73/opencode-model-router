// Test cases 6-9: health states, cooldown, cost ceiling, unknown quota.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpDir, cleanupDir, baseConfig } from "./helpers.ts";
import * as io from "../src/io.ts";
import {
  defaultHealthFile,
  effectiveState,
  isCooldownActive,
  setCooldown,
  clearCooldown,
  loadHealth,
  saveHealth,
} from "../src/health.ts";
import { estimateCost, exceedsRequestCeiling, exceedsRateCeiling, isQuotaKnown } from "../src/cost.ts";
import type { HealthFile } from "../src/types.ts";

let dir: string;
const OLD_DIR = process.env.ROUTER_DIR;

beforeEach(async () => {
  dir = await tmpDir("health");
  process.env.ROUTER_DIR = dir;
});
afterEach(async () => {
  await cleanupDir(dir);
  if (OLD_DIR) process.env.ROUTER_DIR = OLD_DIR;
  else delete process.env.ROUTER_DIR;
});

// CASE 6: provider health states enumeration + effectiveState honoring cooldown.
test("CASE 6: provider health states and effective state", () => {
  const nowMs = io.now();
  const h: HealthFile = {
    providers: {
      free: { state: "AVAILABLE", lastCheckedAt: nowMs },
      payg: { state: "EXHAUSTED", lastCheckedAt: nowMs },
      other: { state: "TEMPORARILY_UNAVAILABLE", lastCheckedAt: nowMs, cooldownUntil: nowMs + 60000 },
    },
    models: {},
    updatedAt: nowMs,
  };
  assert.equal(effectiveState(h, "free", nowMs), "AVAILABLE");
  assert.equal(effectiveState(h, "payg", nowMs), "EXHAUSTED");
  // cooldown active => TEMPORARILY_UNAVAILABLE regardless of stored state
  assert.equal(effectiveState(h, "other", nowMs), "TEMPORARILY_UNAVAILABLE");
  // after cooldown expiry => falls back to stored state
  assert.equal(effectiveState(h, "other", nowMs + 120000), "TEMPORARILY_UNAVAILABLE");
});

// CASE 7: cooldown behavior (set, active, clear, expiry).
test("CASE 7: cooldown set/active/clear", async () => {
  await setCooldown("free", 300, "rate limited");
  const h = await loadHealth();
  assert.equal(h.providers["free"].state, "TEMPORARILY_UNAVAILABLE");
  assert.ok(isCooldownActive(h, "free", io.now(), { cooldownSeconds: 300 }));
  const cleared = await clearCooldown("free");
  assert.equal(cleared, true);
  const h2 = await loadHealth();
  assert.equal(h2.providers["free"], undefined);
});

// CASE 8: cost ceiling checks.
test("CASE 8: cost ceiling", () => {
  const cfg = baseConfig();
  // disabled PAYG => everything rejected as beyond ceiling
  assert.equal(exceedsRequestCeiling({ inputTokens: 1000, outputTokens: 1000, costInputPerM: 1, costOutputPerM: 1 }, cfg), true);

  const cfgOn = { ...cfg, payg: { ...cfg.payg, enabled: true, maxCostPerRequestUSD: 0.1 } };
  // small request under cap
  assert.equal(exceedsRequestCeiling({ inputTokens: 10000, outputTokens: 5000, costInputPerM: 1, costOutputPerM: 1 }, cfgOn), false);
  // huge request over cap
  assert.equal(exceedsRequestCeiling({ inputTokens: 5000000, outputTokens: 5000000, costInputPerM: 1, costOutputPerM: 1 }, cfgOn), true);

  // rate ceiling
  const cfgRate = { ...cfg, payg: { ...cfg.payg, enabled: true, maxCostPerMillionInput: 2, maxCostPerMillionOutput: 5 } };
  assert.equal(exceedsRateCeiling(1, 4, cfgRate), false);
  assert.equal(exceedsRateCeiling(3, 4, cfgRate), true);
  assert.equal(exceedsRateCeiling(1, 6, cfgRate), true);
});

// CASE 9: unknown quota handling.
test("CASE 9: unknown quota is not claimed", () => {
  assert.equal(isQuotaKnown(5), true);
  assert.equal(isQuotaKnown(undefined), false);
  assert.equal(isQuotaKnown(null), false);
  assert.equal(isQuotaKnown(NaN), false);
  assert.equal(isQuotaKnown("5"), false);
  // estimateCost handles unknown rates as 0 (unknown => assume 0 cost, never overclaim)
  assert.equal(estimateCost({ inputTokens: 1000, outputTokens: 0, costInputPerM: 0, costOutputPerM: 0 }), 0);
});
