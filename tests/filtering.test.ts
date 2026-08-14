// Test cases 1-5: Free detection, capability classification, preferred
// filtering, Fisher-Yates (unbiased + no duplicates), fallback ordering.

import { test } from "node:test";
import assert from "node:assert/strict";
import { baseConfig, freeFixtures, makeModel, paidFixture } from "./helpers.ts";
import { isFreeByPricing, filterModel, classifyCapability, type Filtered } from "../src/filter.ts";
import { filterPreferred } from "../src/preferences.ts";
import { buildFreeChain, shuffle } from "../src/randomize.ts";
import { buildChain, decideProvider } from "../src/fallback.ts";
import type { RouterConfig } from "../src/types.ts";

const cfg = baseConfig();

function toFiltered(...models: Array<Filtered | null>): Filtered[] {
  return models.filter((m): m is Filtered => m !== null);
}

// CASE 1: Free model detection from ACTUAL pricing fields.
test("CASE 1: free detection uses pricing fields, not name suffix", () => {
  // Zero-cost pricing => free even without :free suffix
  assert.equal(isFreeByPricing(makeModel({ id: "x/zero-cost", pricing: { prompt: 0, completion: 0, request: 0 } })), true);
  // :free suffix but nonzero pricing => NOT free (we trust pricing over name)
  assert.equal(isFreeByPricing(makeModel({ id: "x/paid:free", pricing: { prompt: 1, completion: 2, request: 0 } })), false);
  // paid
  assert.equal(isFreeByPricing(paidFixture), false);
  // request fee makes it non-free
  assert.equal(isFreeByPricing(makeModel({ id: "x/req", pricing: { prompt: 0, completion: 0, request: 0.01 } })), false);
  // undefined pricing => treated as 0 => free
  assert.equal(isFreeByPricing(makeModel({ id: "x/undef" })), true);
});

// CASE 2: capability classification from metadata.
test("CASE 2: capability classification", () => {
  const coding = makeModel({ id: "qwen/qwen3-14b", supported_parameters: ["tools"] });
  const reasoning = makeModel({ id: "deepseek/deepseek-r1", supported_parameters: ["tools", "reasoning"] });
  const multimodal = makeModel({
    id: "x/gemini",
    supported_parameters: ["tools"],
    architecture: { modality: "text", input_modalities: ["image", "text"], output_modalities: ["text"] },
  });
  const notools = makeModel({ id: "nvidia/nemotron-nano", supported_parameters: [] });

  assert.equal(classifyCapability(coding), "coding");
  assert.equal(classifyCapability(reasoning), "reasoning");
  assert.equal(classifyCapability(multimodal), "general");
  assert.equal(classifyCapability(notools), "unknown");

  // --- Coding-signal cases (TASK 1 fix): explicit code focus => coding,
  // even though supported_parameters may include "reasoning". ---
  const codeModel = makeModel({
    id: "cohere/north-mini-code:free",
    name: "Cohere: North Mini Code (free)",
    supported_parameters: ["tools", "reasoning", "include_reasoning"],
  });
  assert.equal(classifyCapability(codeModel), "coding", "cohere/north-mini-code:free should be coding");

  // A multimodal model WITHOUT a code signal stays general.
  const multimodalNoCode = makeModel({
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    supported_parameters: ["tools"],
    architecture: { modality: "text+image->text", input_modalities: ["image", "text"], output_modalities: ["text"] },
  });
  assert.equal(classifyCapability(multimodalNoCode), "general");

  // A general text model without a code or reasoning signal and WITH tools
  // is classified coding (the original supportsTools fallback intent), NOT
  // reasoning (the greedy heuristic must no longer swallow it).
  const textToolsNoSignal = makeModel({ id: "openai/gpt-oss-20b:free", supported_parameters: ["tools", "reasoning", "include_reasoning"] });
  assert.equal(classifyCapability(textToolsNoSignal), "coding");
});

// CASE 3: preferred-model filtering (whitelist, prune unavailable).
test("CASE 3: preferred-model filtering", () => {
  const pool = toFiltered(
    filterModel(freeFixtures[0], cfg), // qwen
    filterModel(freeFixtures[1], cfg), // deepseek-r1
    filterModel(freeFixtures[3], cfg), // kimi
  );
  const onlyQwen = filterPreferred(pool, ["qwen"]);
  assert.equal(onlyQwen.length, 1);
  assert.equal(onlyQwen[0].model.id, "qwen/qwen3-14b:free");

  // empty preferred => returns all
  assert.equal(filterPreferred(pool, []).length, 3);

  // no match => empty
  assert.equal(filterPreferred(pool, ["does-not-exist"]).length, 0);
});

// CASE 4a: Fisher-Yates shuffle is unbiased-ish and preserves membership.
test("CASE 4a: fisher-yates unbiased shuffle (distribution sanity)", () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7];
  const runs = 20000;
  const counts = new Array(items.length).fill(0);
  for (let r = 0; r < runs; r++) {
    const c = shuffle([...items]);
    // first position distribution should be ~ uniform
    counts[c[0]]++;
  }
  const expected = runs / items.length;
  for (let i = 0; i < items.length; i++) {
    // allow generous tolerance for randomness
    assert.ok(Math.abs(counts[i] - expected) < expected * 0.25, `position ${i} off: ${counts[i]} vs ${expected}`);
  }
});

// CASE 4b: Fisher-Yates produces a permutation (no duplicates, no losses).
test("CASE 4b: fisher-yates no duplicates and complete", () => {
  for (let r = 0; r < 100; r++) {
    const src = ["a", "b", "c", "d", "e"];
    const out = shuffle([...src]);
    assert.deepEqual([...out].sort(), [...src].sort());
    assert.equal(new Set(out).size, out.length);
  }
});

// CASE 4c: chain length is hard-clamped to OPENROUTER_MODELS_MAX (3),
// regardless of the config value. OpenRouter rejects >3-item models[] arrays.
test("CASE 4c: buildFreeChain clamps to OPENROUTER_MODELS_MAX (3) even when config is larger", () => {
  const pool = toFiltered(
    filterModel(freeFixtures[0], cfg), // qwen
    filterModel(freeFixtures[1], cfg), // deepseek-r1
    filterModel(freeFixtures[3], cfg), // kimi
    filterModel(makeModel({ id: "extra/one:free", supported_parameters: ["tools"] }), cfg),
    filterModel(makeModel({ id: "extra/two:free", supported_parameters: ["tools"] }), cfg),
  );
  // 5 distinct models, config says allow 5, but the hard ceiling is 3.
  const chain = buildFreeChain(pool, { enabled: false, maxChain: 5 });
  assert.ok(chain.models.length <= 3, `should clamp to 3, got ${chain.models.length}`);
  assert.equal(chain.truncated, true);
});

// CASE 5: fallback ordering - free first, then opencode-go, etc.
test("CASE 5: fallback ordering", () => {
  const pool = toFiltered(...freeFixtures.map((m) => filterModel(m, cfg)));
  const healthy = { free: "AVAILABLE", "opencode-go": "AVAILABLE", "deepseek/zai": "AVAILABLE", payg: "AVAILABLE" } as const;

  // free healthy + pool => free selected
  const d1 = decideProvider(
    { agent: "coder", capability: "coding", freePool: pool, health: healthy, randomizeEnabled: false, maxFreePerChain: 4 },
    cfg,
  );
  assert.equal(d1.provider, "free");
  assert.equal(d1.isFree, true);
  assert.ok(d1.chain.length > 0);

  // free unhealthy but opencode-go healthy => HONEST non-executable outcome:
  // cross-provider switching is impossible in 1.18.10, so we do NOT claim
  // "opencode-go selected". The decision stays on free with no chain and
  // executable=false.
  const d2 = decideProvider(
    {
      agent: "coder",
      capability: "coding",
      freePool: pool,
      health: { free: "EXHAUSTED", "opencode-go": "AVAILABLE", "deepseek/zai": "AVAILABLE", payg: "AVAILABLE" },
      randomizeEnabled: false,
      maxFreePerChain: 4,
    },
    cfg,
  );
  assert.equal(d2.provider, "free");
  assert.equal(d2.executable, false);
  assert.equal(d2.chain.length, 0);
  assert.equal(d2.model, "");
  assert.ok(d2.note && d2.note.includes("NOT"), "note should flag non-automatic switch");
});
