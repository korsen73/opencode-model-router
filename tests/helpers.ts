// Shared test helpers: a base config, fixture catalog models, and temp dirs.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CatalogModel, RouterConfig } from "../src/types.ts";

export function baseConfig(): RouterConfig {
  return {
    version: 1,
    providerOrder: ["free", "opencode-go", "deepseek/zai", "payg"],
    randomizeFreeModels: true,
    maxFreeModelsPerChain: 4,
    freeModelCooldownSeconds: 300,
    discovery: {
      url: "https://openrouter.ai/api/v1/models",
      refreshHours: 24,
      apiKeyEnv: "OPENROUTER_API_KEY",
      timeoutMs: 15000,
    },
    dailyReset: { hour: 0, minute: 0 },
    endpointHealthTtlSeconds: 300,
    payg: {
      enabled: false,
      maxCostPerMillionInput: null,
      maxCostPerMillionOutput: null,
      maxCostPerRequestUSD: 0.1,
    },
    qualityFloor: { minContext: 32000, tools: true },
    capabilities: {
      coding: { minContext: 64000, tools: true, preferred: ["qwen", "deepseek", "kimi", "glm"] },
      reasoning: { minContext: 64000, tools: true, preferred: ["qwen", "deepseek-r1", "kimi"] },
      general: { minContext: 32000, tools: true, preferred: [] },
      chat: { minContext: 32000, tools: false, preferred: ["nemotron"] },
    },
    agentCapability: {
      manager: "reasoning",
      planner: "reasoning",
      builder: "coding",
      coder: "coding",
      debugger: "coding",
      tester: "coding",
      quant: "reasoning",
      reviewer: "reasoning",
      expert: "reasoning",
      chat: "chat",
    },
    providers: {
      free: { providerID: "openrouter", tier: "free", label: "OpenRouter Free" },
      "opencode-go": { providerID: "opencode-go", tier: "opencode-go", label: "OpenCode Go" },
      "deepseek/zai": { providerID: "deepseek", tier: "deepseek/zai", label: "DeepSeek / Z.ai" },
      payg: { providerID: "openrouter", tier: "payg", label: "OpenRouter PAYG" },
    },
    providerHealth: {
      free: "AVAILABLE",
      "opencode-go": "AVAILABLE",
      "deepseek/zai": "CONFIGURATION_ERROR",
      payg: "DISABLED",
    },
  };
}

export function makeModel(partial: Partial<CatalogModel> & { id: string }): CatalogModel {
  return {
    ...partial,
    id: partial.id,
    name: partial.name ?? partial.id,
    pricing: partial.pricing ?? { prompt: 0, completion: 0, request: 0 },
    context_length: partial.context_length ?? 131072,
    supported_parameters: partial.supported_parameters ?? ["tools"],
    architecture: partial.architecture ?? { modality: "text", input_modalities: ["text"], output_modalities: ["text"] },
    created: partial.created ?? 1700000000,
  };
}

/** A few representative free catalog fixtures. */
export const freeFixtures: CatalogModel[] = [
  makeModel({
    id: "qwen/qwen3-14b:free",
    name: "Qwen3 14B",
    context_length: 128000,
    supported_parameters: ["tools", "structured_outputs"],
  }),
  makeModel({
    id: "deepseek/deepseek-r1:free",
    name: "DeepSeek R1",
    context_length: 64000,
    supported_parameters: ["tools", "reasoning"],
    architecture: { modality: "text", input_modalities: ["text"], output_modalities: ["text"] },
  }),
  makeModel({
    id: "nvidia/nemotron-3-nano:free",
    name: "Nemotron 3 Nano",
    context_length: 32768,
    supported_parameters: [],
  }),
  makeModel({
    id: "kimi/kimi-k2:free",
    name: "Kimi K2",
    context_length: 131072,
    supported_parameters: ["tools"],
  }),
];

/** A paid model fixture. */
export const paidFixture: CatalogModel = makeModel({
  id: "deepseek/deepseek-chat",
  name: "DeepSeek Chat",
  context_length: 131072,
  supported_parameters: ["tools"],
  pricing: { prompt: 0.27, completion: 1.1, request: 0 },
});

export async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `router-test-${prefix}-`));
}

export async function cleanupDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Fake fetch that returns a canned OpenRouter /models response. */
export function fakeFetch(models: CatalogModel[], status = 200, delayMs = 0): FetchLike {
  return async (_url: string, _init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, delayMs));
    const body = { data: models };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

/** Fake fetch that throws/aborts. */
export function failingFetch(err: unknown): FetchLike {
  return async () => {
    throw err;
  };
}
