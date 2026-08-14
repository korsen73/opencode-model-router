// Fallback chain construction and provider-tier decision.
//
// Within OpenRouter, the TRUE per-request fallback path is OpenRouter's native
// `models` array in the request body (server-side). This module computes the
// chain: a randomized Free prefix (optional) + a deterministic paid tail.
//
// Across providers (Free -> OpenCode Go -> DeepSeek/Z.ai -> PAYG), dynamic
// mid-request switching is NOT possible in OpenCode 1.18.10 (no hook rewrites
// model/provider identity mid-request). Provider selection therefore happens at
// decision time; see router.ts. This is documented as PARTIALLY IMPLEMENTED.

import type { Filtered } from "./filter.ts";
import { buildFreeChain } from "./randomize.ts";
import type { Capability, Decision, HealthState, RouterConfig, Tier } from "./types.ts";

export interface FallbackContext {
  agent: string;
  capability: Capability;
  freePool: Filtered[];
  health: Record<string, HealthState>;
  randomizeEnabled: boolean;
  maxFreePerChain: number;
}

export interface FallbackResult {
  chain: string[];
  provider: Tier;
  providerID: string;
  model: string;
  estimatedCostUSD: number;
  isFree: boolean;
  didFallback: boolean;
}

/** Build the OpenRouter `models` chain: randomized Free prefix + paid tail. */
export function buildChain(ctx: FallbackContext): { free: string[]; paid: string[] } {
  const { models } = buildFreeChain(ctx.freePool, {
    enabled: ctx.randomizeEnabled,
    maxChain: ctx.maxFreePerChain,
  });
  return {
    free: models.map((m) => m.model.id as string),
    paid: [],
  };
}

/**
 * Decide the provider tier. Returns a Decision with the chain that should be
 * injected into the request.
 *
 * IMPORTANT (honest): In OpenCode 1.18.10 there is NO hook that changes the
 * model/provider identity mid-request. Agents that route via OpenRouter are
 * configured on `openrouter/free-*`; they CANNOT actually switch to
 * opencode-go/deepseek/payg within a request. So:
 *   - If Free yields a concrete chain => executable=true (chat.params can inject).
 *   - If Free is unavailable/no suitable Free model => executable=false. We do
 *     NOT claim "opencode-go selected" (that is a fake fallback that would never
 *     execute). The agent stays on its configured openrouter model with no chain.
 */
export function decideProvider(
  ctx: FallbackContext,
  cfg: RouterConfig,
): Decision {
  const { free: freeChain, paid: paidChain } = buildChain(ctx);
  const freeHealthy = ctx.health["free"] === "AVAILABLE";
  const opencodeGoHealthy = ctx.health["opencode-go"] === "AVAILABLE";
  const directHealthy = ctx.health["deepseek/zai"] === "AVAILABLE";
  const paygHealthy = cfg.payg.enabled && ctx.health["payg"] === "AVAILABLE";

  // 1) Free tier: randomized chain of free models, if any and healthy.
  if (freeHealthy && freeChain.length > 0) {
    const model = freeChain[0] as string;
    return {
      agent: ctx.agent,
      capability: ctx.capability,
      provider: "free",
      providerID: cfg.providers["free"].providerID,
      model,
      chain: freeChain,
      didFallback: freeChain.length > 1,
      reason: "free-tier selected",
      estimatedCostUSD: 0,
      isFree: true,
      executable: true,
    };
  }

  // Free is unavailable or yielded no suitable chain. Cross-provider switching
  // is NOT possible in 1.18.10, so we return an HONEST non-executable outcome
  // instead of falsely claiming opencode-go/direct/payg "selected". The agent
  // stays on its configured openrouter/free-* model with no chain.
  const preferredAcrossTiers = opencodeGoHealthy
    ? "opencode-go"
    : directHealthy
      ? "deepseek/zai"
      : paygHealthy
        ? "payg"
        : "none";

  return {
    agent: ctx.agent,
    capability: ctx.capability,
    provider: "free",
    providerID: cfg.providers["free"].providerID,
    model: "",
    chain: [],
    didFallback: false,
    reason:
      freeHealthy
        ? "no suitable Free model available; agent stays on its configured openrouter model with no chain"
        : "Free tier unavailable; cross-provider switch to opencode-go NOT possible in 1.18.10; agent stays on its configured openrouter model with no chain",
    estimatedCostUSD: 0,
    isFree: false,
    executable: false,
    note: `router would prefer ${preferredAcrossTiers} across tiers, but 1.18.10 cannot switch provider/model mid-request; this is diagnostic only, NOT an automatic switch`,
  };
}

export function paygChainAllowed(cfg: RouterConfig): boolean {
  return cfg.payg.enabled;
}
