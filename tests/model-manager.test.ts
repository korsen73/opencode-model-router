// Tests for Step 2: capability-based Model Manager (4 routing classes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankForClass, selectTop4, classForAgent } from "../src/model-manager.ts";
import type { RegistryModel } from "../src/types.ts";

function rm(id: string, s: { intelligence?: number | null; coding?: number | null; agentic?: number | null }, over: Partial<RegistryModel> = {}): RegistryModel {
  return {
    id, providerID: "openrouter", isFree: true, capability: "coding", context: 100000,
    tools: true, costInput: 0, costOutput: 0, status: "discovered", stale: false, discoveredAt: 0,
    scores: { intelligence: s.intelligence ?? null, coding: s.coding ?? null, agentic: s.agentic ?? null },
    normalizedCapabilities: { tools: true, reasoning: true, structured_outputs: false, input_modalities: ["text"], output_modalities: ["text"] },
    ...over,
  };
}

const MODELS = [
  rm("nvidia/nemotron-3-ultra-550b:free", { intelligence: 38.3, coding: 49.3, agentic: 27.5 }, { context: 1000000 }),
  rm("google/gemma-4-31b:free", { intelligence: 29.7, coding: 43.4, agentic: 14.4 }, { context: 262144 }),
  rm("google/gemma-4-26b:free", { intelligence: 26.1, coding: 39.3, agentic: 11.0 }, { context: 262144 }),
  rm("nvidia/nemotron-3-super:free", { intelligence: 25.7, coding: 37.7, agentic: 8.8 }, { context: 262144 }),
  rm("nvidia/nemotron-3.5-lightning:free", { intelligence: 23.6, coding: 26.8, agentic: 13.8 }, { context: 1000000 }),
  rm("x/noidx", { intelligence: null, coding: null, agentic: null }),
];

// CASE M1: CODING ranks by coding_index desc.
test("M1: CODING ranks by coding_index desc", () => {
  const r = rankForClass(MODELS, "coding").map((x) => x.model.id);
  assert.deepEqual(r.slice(0, 5), [
    "nvidia/nemotron-3-ultra-550b:free",
    "google/gemma-4-31b:free",
    "google/gemma-4-26b:free",
    "nvidia/nemotron-3-super:free",
    "nvidia/nemotron-3.5-lightning:free",
  ]);
  // null-index model excluded from coding
  assert.ok(!r.includes("x/noidx"));
});

// CASE M2: REASONING ranks by intelligence desc.
test("M2: REASONING ranks by intelligence desc", () => {
  const r = rankForClass(MODELS, "reasoning").map((x) => x.model.id);
  assert.equal(r[0], "nvidia/nemotron-3-ultra-550b:free");
  assert.equal(r[1], "google/gemma-4-31b:free");
  assert.ok(!r.includes("x/noidx"));
});

// CASE M3: MANAGER ranks by intelligence desc.
test("M3: MANAGER ranks by intelligence desc", () => {
  const r = rankForClass(MODELS, "manager").map((x) => x.model.id);
  assert.equal(r[0], "nvidia/nemotron-3-ultra-550b:free");
});

// CASE M4: CODING_AGENT ranks by agentic desc, then coding.
test("M4: CODING_AGENT ranks by agentic desc", () => {
  const r = rankForClass(MODELS, "coding_agent").map((x) => x.model.id);
  // ultra(27.5) > gemma-31b(14.4) > lightning(13.8) > gemma-26b(11.0) > super(8.8)
  assert.equal(r[0], "nvidia/nemotron-3-ultra-550b:free");
  assert.equal(r[1], "google/gemma-4-31b:free");
  assert.equal(r[2], "nvidia/nemotron-3.5-lightning:free");
  assert.equal(r[3], "google/gemma-4-26b:free");
});

// CASE M5: deterministic Top 4 (primary + 3 fallbacks), no randomness in order.
test("M5: selectTop4 primary deterministic, fallbacks bounded to 3", () => {
  const t = selectTop4(MODELS, "coding", 4, null, false);
  assert.equal(t.primary?.id, "nvidia/nemotron-3-ultra-550b:free");
  assert.equal(t.fallbacks.length, 3);
  assert.equal(t.fallbacks[0]!.id, "google/gemma-4-31b:free");
  assert.ok(!t.fallbacks.includes(t.primary!));
});

// CASE M6: health filter prefers healthy models.
test("M6: health filter prefers healthy models for primary", () => {
  const healthy = new Set(["google/gemma-4-31b:free"]); // only gemma-31b healthy
  const t = selectTop4(MODELS, "coding", 4, healthy, false);
  // gemma-31b moved to front despite lower coding index
  assert.equal(t.primary?.id, "google/gemma-4-31b:free");
});

// CASE M7: randomization randomizes fallback order but not primary.
test("M7: randomization shuffles fallbacks, primary stays deterministic", () => {
  const t1 = selectTop4(MODELS, "coding", 4, null, true);
  const t2 = selectTop4(MODELS, "coding", 4, null, true);
  assert.equal(t1.primary?.id, t2.primary?.id);
  assert.equal(t1.primary?.id, "nvidia/nemotron-3-ultra-550b:free");
  // fallback sets equal regardless of order (compare by id)
  const ids = (t: { fallbacks: { id: string }[] }) => t.fallbacks.map((f) => f.id).sort();
  assert.deepEqual(ids(t1), ids(t2));
});

// CASE M8: classForAgent resolves mapping with manager default.
test("M8: classForAgent maps agents, default manager", () => {
  const cfg = { agentClass: { coder: "coding", quant: "reasoning" as const } } as never;
  assert.equal(classForAgent(cfg, "coder"), "coding");
  assert.equal(classForAgent(cfg, "quant"), "reasoning");
  assert.equal(classForAgent(cfg, "unknown-agent"), "manager");
});

// CASE M9: empty pool -> primary null.
test("M9: empty/no-eligible pool -> primary null", () => {
  const t = selectTop4([rm("x/noidx", {})], "coding", 4, null, false);
  assert.equal(t.primary, null);
});
