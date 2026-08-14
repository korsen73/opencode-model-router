// Test cases 10-17: stale registry, OpenRouter API failure, direct provider
// failure, OpenCode Go unavailable, final PAYG fallback, credential missing,
// no suitable Free model, all providers unavailable.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpDir, cleanupDir, baseConfig, freeFixtures, fakeFetch, failingFetch, makeModel } from "./helpers.ts";
import * as io from "../src/io.ts";
import { refreshModels, decide } from "../src/router.ts";
import { markStale, fetchModels } from "../src/discover.ts";
import { setProviderState, setCooldown } from "../src/health.ts";
import type { RegistryFile, RouterConfig } from "../src/types.ts";

type Reg = { discovered: RegistryFile["discovered"] };

let dir: string;
const OLD_DIR = process.env.ROUTER_DIR;
const OLD_KEY = process.env.OPENROUTER_API_KEY;

beforeEach(async () => {
  dir = await tmpDir("router");
  process.env.ROUTER_DIR = dir;
  process.env.OPENROUTER_API_KEY = "test-key";
});
afterEach(async () => {
  await cleanupDir(dir);
  if (OLD_DIR) process.env.ROUTER_DIR = OLD_DIR;
  else delete process.env.ROUTER_DIR;
  if (OLD_KEY) process.env.OPENROUTER_API_KEY = OLD_KEY;
  else delete process.env.OPENROUTER_API_KEY;
});

// CASE 10: stale model registry marking.
test("CASE 10: stale model registry", async () => {
  const cfg = baseConfig();
  await refreshModels(cfg, fakeFetch(freeFixtures));
  // mark two as stale
  await markStale([freeFixtures[0].id, freeFixtures[1].id]);
  const reg = await io.readJson<Reg>("models.json", { discovered: [] });
  const stale = reg.discovered.filter((m) => m.stale);
  assert.equal(stale.length, 2);
  assert.ok(stale.every((m) => m.stale === true));
  // stale models should NOT be candidates for routing
  const d = await decide(cfg, "coder");
  // qwen & deepseek-r1 are stale, kimi remains; free chain should not include stale
  assert.ok(d.chain.length > 0);
  assert.ok(!d.chain.includes(freeFixtures[0].id));
  assert.ok(!d.chain.includes(freeFixtures[1].id));
});

// CASE 11: OpenRouter API failure -> stale cache fallback.
test("CASE 11: OpenRouter API failure falls back to stale cache", async () => {
  const cfg = baseConfig();
  // seed cache via successful discovery
  await refreshModels(cfg, fakeFetch(freeFixtures));
  // now fail the API; discoverModels should fall back to stale cache
  const { discoverModels } = await import("../src/discover.ts");
  const result = await discoverModels(cfg, { fetchFn: failingFetch(new Error("network down")) });
  assert.equal(result.fromCache, true);
  assert.ok(result.models.length > 0);
});

test("CASE 11b: API failure without cache throws", async () => {
  const cfg = baseConfig();
  let threw = false;
  try {
    await fetchModels(cfg, { fetchFn: failingFetch(new Error("boom")) });
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
});

// CASE 12: direct provider (DeepSeek/Z.ai) failure.
test("CASE 12: direct provider failure -> honest non-executable outcome", async () => {
  const cfg = baseConfig();
  await refreshModels(cfg, fakeFetch(freeFixtures));
  // free exhausted, opencode-go unavailable, direct down => no executable Free
  // decision. Honest outcome: provider=free, executable=false (no fake switch).
  await setProviderState("openrouter", "EXHAUSTED");
  await setProviderState("opencode-go", "TEMPORARILY_UNAVAILABLE");
  await setProviderState("deepseek", "TEMPORARILY_UNAVAILABLE");
  const d = await decide(cfg, "coder");
  assert.equal(d.provider, "free");
  assert.equal(d.executable, false);
  assert.equal(d.chain.length, 0);
});

// CASE 13: OpenCode Go unavailable does NOT switch mid-request.
test("CASE 13: OpenCode Go unavailable -> honest non-executable outcome (no fake switch)", async () => {
  const cfg = baseConfig();
  await refreshModels(cfg, fakeFetch([])); // no free models
  await setProviderState("opencode-go", "TEMPORARILY_UNAVAILABLE");
  await setProviderState("deepseek", "AVAILABLE");
  const d = await decide(cfg, "coder");
  // Even though deepseek is "available" across tiers, 1.18.10 cannot switch
  // mid-request, so the decision is NOT executable.
  assert.equal(d.executable, false);
  assert.equal(d.provider, "free");
  assert.equal(d.chain.length, 0);
});

// CASE 14: PAYG cannot be reached as a mid-request switch (honest outcome).
test("CASE 14: PAYG disabled for mid-request switch (honest)", async () => {
  const cfg = { ...baseConfig(), payg: { ...baseConfig().payg, enabled: true } };
  await refreshModels(cfg, fakeFetch([]));
  await setProviderState("opencode-go", "TEMPORARILY_UNAVAILABLE");
  await setProviderState("deepseek", "TEMPORARILY_UNAVAILABLE");
  await setProviderState("openrouter", "AVAILABLE");
  const d = await decide(cfg, "coder");
  // No Free chain, so no executable decision. PAYG is NOT auto-selected for a
  // mid-request switch (1.18.10 cannot switch provider identity).
  assert.equal(d.executable, false);
  assert.equal(d.chain.length, 0);
});

// CASE 15: credential missing.
test("CASE 15: credential missing does not break discovery (public endpoint)", async () => {
  delete process.env.OPENROUTER_API_KEY;
  const cfg = baseConfig();
  // Public /models endpoint works without auth; our fake fetch ignores auth.
  await refreshModels(cfg, fakeFetch(freeFixtures));
  const reg = await io.readJson<Reg>("models.json", { discovered: [] });
  assert.ok(reg.discovered.length > 0);
});

// CASE 16: no suitable Free model -> honest non-executable outcome (no fake switch).
test("CASE 16: no suitable Free model -> non-executable, no fake opencode-go", async () => {
  const cfg = baseConfig();
  // models fail the quality floor (small context, no tools)
  const bad = [
    makeModel({ id: "a/tiny", context_length: 1000, supported_parameters: [] }),
    makeModel({ id: "b/tiny2", context_length: 500, supported_parameters: [] }),
  ];
  await refreshModels(cfg, fakeFetch(bad));
  await setProviderState("opencode-go", "AVAILABLE");
  const d = await decide(cfg, "coder");
  // Even though opencode-go is available, it cannot be auto-selected for a
  // mid-request switch. Honest outcome: not executable, no chain, no fake claim.
  assert.equal(d.provider, "free");
  assert.equal(d.executable, false);
  assert.equal(d.chain.length, 0);
});

// CASE 17: all providers unavailable -> honest non-executable decision.
test("CASE 17: all providers unavailable -> non-executable decision", async () => {
  const cfg = baseConfig();
  await refreshModels(cfg, fakeFetch([]));
  await setProviderState("opencode-go", "TEMPORARILY_UNAVAILABLE");
  await setProviderState("deepseek", "TEMPORARILY_UNAVAILABLE");
  await setProviderState("openrouter", "TEMPORARILY_UNAVAILABLE");
  const d = await decide(cfg, "coder");
  assert.equal(d.provider, "free");
  assert.equal(d.model, "");
  assert.equal(d.chain.length, 0);
  assert.equal(d.executable, false);
});
