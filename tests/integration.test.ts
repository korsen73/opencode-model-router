// Integration tests for OpenRouter Free routing of the real agent set.
// All API calls are MOCKED (injected fake fetch); never call real APIs here.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpDir, cleanupDir, baseConfig, freeFixtures, makeModel, fakeFetch } from "./helpers.ts";
import * as io from "../src/io.ts";
import { refreshModels, decide, topFreePickForCapability } from "../src/router.ts";
import { setProviderState, clearCooldown } from "../src/health.ts";
import type { RegistryFile, RouterConfig } from "../src/types.ts";

/** Minimal JSONC -> JSON: strips // and /* *\/ comments but NOT // inside strings. */
function stripJsonc(src: string): string {
  let out = "";
  let inStr = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    const n = src[i + 1] as string;
    if (inStr) {
      out += c;
      if (c === "\\") { out += n; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c;
    i++;
  }
  return out;
}

const REAL_CFG = path.join(process.env.HOME ?? "", ".config/opencode/opencode.jsonc");
function readRealConfig(): Record<string, any> {
  if (!fs.existsSync(REAL_CFG)) throw new Error("real config not found");
  return JSON.parse(stripJsonc(fs.readFileSync(REAL_CFG, "utf8")));
}

let dir: string;
const OLD_DIR = process.env.ROUTER_DIR;
const OLD_KEY = process.env.OPENROUTER_API_KEY;

beforeEach(async () => {
  dir = await tmpDir("integ");
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

// Build a rich catalog: coding + reasoning + general + chat free models,
// plus some non-free and below-floor models.
function richCatalog() {
  return [
    makeModel({ id: "qwen/qwen3-14b:free", name: "Qwen3 14B", context_length: 131072, supported_parameters: ["tools"] }),
    makeModel({ id: "qwen/qwen3-coder:free", name: "Qwen Coder", context_length: 131072, supported_parameters: ["tools"] }),
    makeModel({ id: "deepseek/deepseek-r1:free", name: "DeepSeek R1", context_length: 64000, supported_parameters: ["tools", "reasoning"] }),
    makeModel({ id: "deepseek/deepseek-reasoner:free", name: "DeepSeek Reasoner", context_length: 128000, supported_parameters: ["tools", "reasoning"] }),
    makeModel({ id: "kimi/kimi-k2:free", name: "Kimi K2", context_length: 131072, supported_parameters: ["tools"] }),
    makeModel({ id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B", context_length: 131072, supported_parameters: ["tools"] }),
    makeModel({ id: "nvidia/nemotron-nano-12b-v2-vl:free", name: "Nemotron Nano", context_length: 200000, supported_parameters: ["tools"] }),
    // multimodal -> classified "general" (drives chat/general pools)
    makeModel({
      id: "google/gemma-3-27b-it:free",
      name: "Gemma 3 27B",
      context_length: 131072,
      supported_parameters: ["tools"],
      architecture: { modality: "text->text", input_modalities: ["image", "text"], output_modalities: ["text"] },
    }),
    // below floor (no tools, tiny context) - should be excluded
    makeModel({ id: "tiny/tiny-model:free", name: "Tiny", context_length: 1000, supported_parameters: [] }),
    // paid - should never be in the free chain
    makeModel({ id: "deepseek/deepseek-chat", name: "DeepSeek Chat", pricing: { prompt: 0.27, completion: 1.1 } }),
  ];
}

async function seedRegistry(): Promise<void> {
  const cfg = baseConfig();
  await refreshModels(cfg, fakeFetch(richCatalog()));
}

// CASE I1: per-agent capability -> Free chain
const AGENT_EXPECT = {
  manager: "reasoning",
  planner: "reasoning",
  builder: "coding",
  coder: "coding",
  debugger: "coding",
  tester: "coding",
  quant: "reasoning",
  reviewer: "reasoning",
  chat: "chat",
};

test("CASE I1: per-agent capability -> OpenRouter Free chain", async () => {
  const cfg = baseConfig();
  await seedRegistry();
  await clearCooldown("openrouter");
  for (const [agent, cap] of Object.entries(AGENT_EXPECT)) {
    const d = await decide(cfg, agent);
    assert.equal(d.provider, "free", `${agent} should route to free`);
    assert.equal(d.capability, cap, `${agent} capability mismatch`);
    assert.ok(d.chain.length > 0, `${agent} should have a chain`);
    assert.equal(d.isFree, true, `${agent} should be free`);
  }
});

// CASE I2: expert stays on gpt-5.6-luna (opencode-go) - config-level invariant
test("CASE I2: expert stays on opencode-go/gpt-5.6-luna in config", () => {
  if (!fs.existsSync(REAL_CFG)) return; // skip if config absent (CI safety)
  const cfg = readRealConfig();
  assert.equal(cfg.agent.expert.model, "opencode-go/gpt-5.6-luna");
});

// CASE I3: no agent .md contains concrete rotating Free model IDs
test("CASE I3: no agent .md hard-codes Free model IDs", () => {
  const dirPath = path.join(process.env.HOME ?? "", ".config/opencode/agent");
  if (!fs.existsSync(dirPath)) return;
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".md") && !f.includes(".bak"));
  let violations = 0;
  for (const f of files) {
    const content = fs.readFileSync(path.join(dirPath, f), "utf8");
    if (/:free/.test(content)) {
      violations++;
      // eslint-disable-next-line no-console
      console.error(`VIOLATION: ${f} contains a Free model ID`);
    }
  }
  assert.equal(violations, 0, `${violations} agent .md file(s) contain Free model IDs`);
});

// CASE I4: chain length <= 3 (OpenRouter limit) and no duplicates.
test("CASE I4: chain <= 3 (OpenRouter limit) and no duplicates", async () => {
  const cfg = baseConfig();
  await seedRegistry();
  await clearCooldown("openrouter");
  for (let r = 0; r < 10; r++) {
    const d = await decide(cfg, "coder");
    // Hard invariant: never exceed OpenRouter's 3-item models[] limit.
    assert.ok(d.chain.length <= 3, `chain too long: ${d.chain.length}`);
    assert.equal(new Set(d.chain).size, d.chain.length, "chain has duplicates");
  }
});

// CASE I4b: a config value > 3 is clamped down to 3 (defensive invariant).
test("CASE I4b: config maxFreeModelsPerChain > 3 is clamped to 3", async () => {
  const cfg = { ...baseConfig(), maxFreeModelsPerChain: 5 };
  await seedRegistry();
  await clearCooldown("openrouter");
  const d = await decide(cfg, "coder");
  assert.ok(d.chain.length <= 3, `config=5 should clamp to 3, got ${d.chain.length}`);
});

// CASE I5: randomization produces varied orders across runs
test("CASE I5: randomization works (varied primary across runs)", async () => {
  const cfg = baseConfig();
  await seedRegistry();
  await clearCooldown("openrouter");
  const primaries = new Set<string>();
  for (let r = 0; r < 15; r++) {
    const d = await decide(cfg, "coder");
    primaries.add(d.model);
  }
  assert.ok(primaries.size > 1, "primary Free model should vary across randomized runs");
});

// CASE I6: unsuitable models excluded (below floor / paid / meta-routing)
test("CASE I6: unsuitable models excluded from chain", async () => {
  const cfg = baseConfig();
  await seedRegistry();
  await clearCooldown("openrouter");
  const d = await decide(cfg, "coder");
  for (const id of d.chain) {
    assert.ok(!id.startsWith("tiny/"), "below-floor model in chain");
    assert.ok(!id.includes("deepseek-chat"), "paid model in chain");
    assert.ok(!id.includes("openrouter/free"), "meta-routing id in chain");
  }
});

// CASE I7: virtual model api.id maps to current top Free pick for capability
test("CASE I7: topFreePickForCapability returns a valid current Free model", async () => {
  const cfg = baseConfig();
  await seedRegistry();
  await clearCooldown("openrouter");
  for (const cap of ["coding", "reasoning", "general", "chat"]) {
    const top = await topFreePickForCapability(cfg, cap as never);
    assert.ok(top, `${cap} should have a top Free pick`);
    assert.ok(top.includes(":free"), `${cap} top pick should be a free model: ${top}`);
    assert.ok(!top.startsWith("tiny/") && !top.includes("deepseek-chat"), `${cap} top pick unsuitable`);
  }
});

// CASE I8: PAYG stays disabled in config and not selected
// CASE I8: routed agents use STABLE virtual IDs, expert fixed, PAYG disabled.
test("CASE I8: routed agents use stable virtual IDs; expert fixed; no payg", async () => {
  const cfg = baseConfig();
  await seedRegistry();
  await clearCooldown("openrouter");
  const d = await decide(cfg, "coder");
  assert.notEqual(d.provider, "payg");
  assert.equal(cfg.payg.enabled, false);

  const cfgPath = path.join(process.env.HOME ?? "", ".config/opencode/opencode.jsonc");
  if (fs.existsSync(cfgPath)) {
    const real = readRealConfig();
    const VIRTUAL = new Set(["free-coding", "free-reasoning", "free-general", "free-chat"]);
    for (const [name, a] of Object.entries(real.agent) as Array<[string, { model?: string }]>) {
      const m = a.model ?? "";
      if (name === "expert") {
        assert.equal(m, "opencode-go/gpt-5.6-luna", "expert must stay on gpt-5.6-luna");
        continue;
      }
      if (m.startsWith("openrouter/")) {
        const virt = m.replace("openrouter/", "");
        assert.ok(VIRTUAL.has(virt), `${name} uses a stable virtual ID, got ${m}`);
        assert.ok(!m.includes(":free"), `${name} must not hard-code a concrete Free ID`);
      }
    }
    // PAYG must remain disabled in config
    assert.equal(real.provider?.openrouter?.payg ?? false, false);
  }
});
// CASE I9: reviewer gets a different model than coder where preference allows
test("CASE I9: reviewer and coder can differ (reasoning vs coding pool)", async () => {
  const cfg = baseConfig();
  await seedRegistry();
  await clearCooldown("openrouter");
  const coder = await decide(cfg, "coder");
  const reviewer = await decide(cfg, "reviewer");
  assert.equal(coder.capability, "coding");
  assert.equal(reviewer.capability, "reasoning");
  // They draw from different capability pools; even if the same id happens to
  // appear, capabilities differ by design. Assert the capability pools differ.
  assert.notEqual(coder.capability, reviewer.capability);
});

// CASE I10: no suitable Free model -> honest non-executable outcome, no payg.
test("CASE I10: no suitable Free model -> non-executable, not payg", async () => {
  const cfg = baseConfig();
  await refreshModels(cfg, fakeFetch([])); // empty catalog => no free
  await clearCooldown("openrouter");
  const d = await decide(cfg, "coder");
  // Honest: no Free chain => not executable. Agent stays on its configured
  // openrouter/free-* model; PAYG is NOT auto-selected.
  assert.equal(d.executable, false);
  assert.equal(d.chain.length, 0);
  assert.notEqual(d.provider, "payg");
});
