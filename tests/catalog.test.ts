// Tests for STEP 1: normalized Model Catalog + capability model + endpoint health.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeModel, enrichRegistryModel } from "../src/catalog.ts";
import { endpointsUrl, bestUptime5m, getEndpointHealth } from "../src/health.ts";
import { baseConfig, makeModel } from "./helpers.ts";
import type { RegistryModel } from "../src/types.ts";

// CASE C1: Free detection from pricing (0/0).
test("C1: normalizeModel detects Free from pricing", () => {
  const free = makeModel({ id: "x/a:free", pricing: { prompt: 0, completion: 0, request: 0 } });
  const paid = makeModel({ id: "x/b", pricing: { prompt: 0.5, completion: 1.5, request: 0 } });
  assert.equal(normalizeModel(free).isFree, true);
  assert.equal(normalizeModel(paid).isFree, false);
});

// CASE C2: score extraction + null stays null (never 0).
test("C2: scores extracted from artificial_analysis, null preserved", () => {
  const m = makeModel({
    id: "x/aa",
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 38.3,
        coding_index: null,
        agentic_index: 27.5,
      },
    },
  });
  const n = normalizeModel(m);
  assert.equal(n.scores.intelligence, 38.3);
  assert.equal(n.scores.coding, null);
  assert.equal(n.scores.agentic, 27.5);
  // no benchmarks -> all null
  const m2 = makeModel({ id: "x/bb" });
  assert.deepEqual(normalizeModel(m2).scores, { intelligence: null, coding: null, agentic: null });
});

// CASE C3: tools / reasoning / structured_outputs detection.
test("C3: capability flags detected from supported_parameters", () => {
  const m = makeModel({
    id: "x/c",
    supported_parameters: ["tools", "reasoning", "structured_outputs"],
  });
  const c = normalizeModel(m).capabilities;
  assert.equal(c.tools, true);
  assert.equal(c.reasoning, true);
  assert.equal(c.structured_outputs, true);
  const plain = makeModel({ id: "x/d", supported_parameters: [] });
  assert.deepEqual(normalizeModel(plain).capabilities, {
    tools: false, reasoning: false, structured_outputs: false,
    input_modalities: ["text"], output_modalities: ["text"],
  });
});

// CASE C4: modalities normalization (lowercase).
test("C4: modalities normalized to lowercase arrays", () => {
  const m = makeModel({
    id: "x/e",
    architecture: { input_modalities: ["Text", "IMAGE"], output_modalities: ["TEXT"] },
  });
  const c = normalizeModel(m).capabilities;
  assert.deepEqual(c.input_modalities, ["text", "image"]);
  assert.deepEqual(c.output_modalities, ["text"]);
});

// CASE C5: enrichRegistryModel attaches metadata + scores + normalized caps.
test("C5: enrichRegistryModel attaches metadata, scores, capabilities", () => {
  const raw = makeModel({
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra",
    canonical_slug: "nemotron-3-ultra-550b-a55b",
    description: "desc",
    expiration_date: "2026-12-31",
    top_provider: "Nvidia",
    benchmarks: { artificial_analysis: { intelligence_index: 38.3, coding_index: 49.3, agentic_index: 27.5 } },
  });
  const base: RegistryModel = {
    id: raw.id, providerID: "openrouter", isFree: true, capability: "coding",
    context: 1000000, tools: true, costInput: 0, costOutput: 0,
    status: "discovered", stale: false, discoveredAt: 0,
  };
  const en = enrichRegistryModel(base, raw);
  assert.equal(en.scores?.coding, 49.3);
  assert.equal(en.scores?.intelligence, 38.3);
  assert.equal(en.normalizedCapabilities?.tools, true);
  assert.equal(en.metadata?.top_provider, "Nvidia");
  assert.equal(en.metadata?.canonical_slug, "nemotron-3-ultra-550b-a55b");
  assert.equal(en.metadata?.expiration_date, "2026-12-31");
});

// CASE C6: endpointsUrl builds the correct path (slash NOT encoded).
test("C6: endpointsUrl keeps author/slug slash unencoded", () => {
  assert.equal(
    endpointsUrl("nvidia/nemotron-3-ultra-550b-a55b:free"),
    "https://openrouter.ai/api/v1/models/nvidia/nemotron-3-ultra-550b-a55b:free/endpoints",
  );
});

// CASE C7: bestUptime5m + null latency/throughput retained.
test("C7: bestUptime5m and null handling", () => {
  const eps = [
    { provider_name: "A", status: 0, uptime_last_5m: 99.8, uptime_last_30m: 99.4, uptime_last_1d: 99.0, latency_last_30m: null, throughput_last_30m: null },
    { provider_name: "B", status: 0, uptime_last_5m: 100, uptime_last_30m: 100, uptime_last_1d: 99.9, latency_last_30m: { p50: 1000 }, throughput_last_30m: null },
  ];
  assert.equal(bestUptime5m(eps), 100);
  assert.equal(bestUptime5m([]), null);
  // latency null preserved in fetch path (parsing test below)
});

// CASE C8: getEndpointHealth fetches, caches per TTL, parses nulls.
test("C8: endpoint health fetch + TTL cache + null parse", async () => {
  const cfg = baseConfig();
  const body = {
    data: {
      endpoints: [
        { provider_name: "Nvidia", status: 0, uptime_last_5m: 99.8, uptime_last_30m: 99.4, uptime_last_1d: 99.0, latency_last_30m: null, throughput_last_30m: null },
      ],
    },
  };
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const id = "test-only/case-c8:free"; // unique id so it never collides with real status.json
  const r1 = await getEndpointHealth(id, cfg, fakeFetch as never);
  assert.equal(r1.cached, false);
  assert.equal(r1.endpoints[0].provider_name, "Nvidia");
  assert.equal(r1.endpoints[0].latency_last_30m, null);
  assert.equal(r1.endpoints[0].uptime_last_5m, 99.8);
  // second call within TTL uses cache
  const r2 = await getEndpointHealth(id, cfg, fakeFetch as never);
  assert.equal(r2.cached, true);
  assert.equal(calls, 1);

  // cleanup: remove our test entry from status.json so we don't pollute state
  const { loadHealth, saveHealth } = await import("../src/health.ts");
  const h = await loadHealth();
  delete h.endpoints?.[id];
  await saveHealth(h);
});
