// Shared types for the OpenCode model router.
// Kept dependency-free so modules can be unit-tested in isolation with node:test.

export type Capability = "coding" | "reasoning" | "general" | "chat" | "unknown";

export type HealthState =
  | "AVAILABLE"
  | "TEMPORARILY_UNAVAILABLE"
  | "EXHAUSTED"
  | "DISABLED"
  | "CONFIGURATION_ERROR"
  | "UNKNOWN";

export type Tier = "free" | "opencode-go" | "deepseek/zai" | "payg";

/** One model in the OpenRouter live catalog (subset of fields we actually use). */
export interface CatalogModel {
  id: string;
  name?: string;
  /** USD per 1M tokens. NOTE: live API returns these as STRINGS ("0"). */
  pricing?: { prompt?: number | string; completion?: number | string; request?: number | string; image?: number | string };
  context_length?: number | null;
  supported_parameters?: string[];
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
  created?: number;
  canonical_slug?: string;
  description?: string;
  expiration_date?: string;
  top_provider?: string;
  reasoning?: unknown;
  /** Artificial Analysis benchmarks from OpenRouter. */
  benchmarks?: {
    artificial_analysis?: {
      intelligence_index?: number | null;
      coding_index?: number | null;
      agentic_index?: number | null;
    };
  };
}

/** Local registry record (models.json). */
export interface RegistryModel {
  id: string;
  providerID: string;
  isFree: boolean;
  capability: Capability;
  context: number;
  tools: boolean;
  costInput: number;
  costOutput: number;
  status: "discovered" | "approved" | "disabled";
  stale: boolean;
  discoveredAt: number;
  lastUsedAt?: number;
  /** Normalized capability scores from OpenRouter Artificial Analysis (null = missing, never 0). */
  scores?: { intelligence: number | null; coding: number | null; agentic: number | null };
  /** Normalized capability flags independent of provider. */
  normalizedCapabilities?: {
    tools: boolean;
    reasoning: boolean;
    structured_outputs: boolean;
    input_modalities: string[];
    output_modalities: string[];
  };
  /** Retained raw OpenRouter metadata for audit/explainability. */
  metadata?: {
    canonical_slug?: string;
    name?: string;
    description?: string;
    created?: number;
    expiration_date?: string;
    top_provider?: string;
    reasoning?: unknown;
    architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
  };
}

export interface RegistryFile {
  discovered: RegistryModel[];
  approved: string[];
  disabled: string[];
  updatedAt: number;
}

export interface ProviderHealth {
  state: HealthState;
  reason?: string;
  lastCheckedAt: number;
  cooldownUntil?: number;
}

export interface EndpointInfo {
  provider_name: string;
  status: number | null;
  uptime_last_5m: number | null;
  uptime_last_30m: number | null;
  uptime_last_1d: number | null;
  latency_last_30m: unknown;
  throughput_last_30m: unknown;
}

export interface HealthFile {
  providers: Record<string, ProviderHealth>;
  models: Record<string, { state: HealthState; cooldownUntil?: number; reason?: string }>;
  /** Per-model endpoint health (dynamic, TTL-cached). */
  endpoints?: Record<string, { endpoints: EndpointInfo[]; fetchedAt: number }>;
  updatedAt: number;
}

export interface UsageProviderCounter {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
}

export interface UsageFile {
  resetKey: string; // YYYY-MM-DD in local tz
  providers: Record<string, UsageProviderCounter>;
  lastUpdated: number;
}

export interface RouterConfig {
  version: number;
  providerOrder: Tier[];
  randomizeFreeModels: boolean;
  maxFreeModelsPerChain: number;
  freeModelCooldownSeconds: number;
  discovery: {
    url: string;
    refreshHours: number;
    apiKeyEnv: string;
    timeoutMs: number;
  };
  /** TTL (seconds) for per-model endpoint health; refreshed dynamically, not daily. */
  endpointHealthTtlSeconds: number;
  dailyReset: { hour: number; minute: number };
  payg: {
    enabled: boolean;
    maxCostPerMillionInput: number | null;
    maxCostPerMillionOutput: number | null;
    maxCostPerRequestUSD: number;
  };
  qualityFloor: { minContext: number; tools: boolean };
  capabilities: Record<string, { minContext: number; tools: boolean; preferred: string[] }>;
  agentCapability: Record<string, string>;
  providers: Record<string, { providerID: string; tier: Tier; label: string }>;
  providerHealth: Record<string, HealthState>;
}

/** A computed fallback chain decision. */
export interface Decision {
  agent: string;
  capability: Capability;
  provider: Tier;
  providerID: string;
  model: string; // primary model ID (OpenRouter id for free/payg)
  chain: string[]; // OpenRouter `models` fallback array
  didFallback: boolean;
  reason: string;
  estimatedCostUSD: number;
  isFree: boolean;
  /**
   * Whether this decision is actually EXECUTABLE as an OpenRouter request.
   * `true` means a concrete chain exists and chat.params can inject it.
   * `false` means no Free chain is available AND cross-provider switching is
   * not possible in 1.18.10 — the agent stays on its configured openrouter
   * model with no chain. Callers MUST NOT inject or log a fake fallback.
   */
  executable: boolean;
  /** Optional diagnostic note for the CLI (not an automatic mid-request switch). */
  note?: string;
}

export interface RoutingLogEntry {
  timestamp: string;
  sessionID?: string;
  agent: string;
  capability: Capability;
  selectedProvider: Tier;
  selectedModel: string;
  chain: string[];
  actualModel?: string;
  reason: string;
  failureReason?: string;
  estimatedCostUSD: number;
  isFree: boolean;
  didFallback: boolean;
}
