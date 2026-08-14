# DEC-005 — PAYG final + OpenRouter native `models` chain

**Status:** Accepted
**Date:** 2026-08-14

## Context
The only TRUE per-request fallback execution path available is OpenRouter's native
`models` fallback array in the request body. PAYG is the last cost-resource tier.

## Decision
1. **Within OpenRouter**: inject the computed chain as `models: [...]` in the
   request body. Verified in the opencode 1.18.10 source: `chat.params`
   output.options flows through `ProviderTransform.providerOptions()` → returns
   `{ openrouter: options }` → the `@openrouter/ai-sdk-provider` spreads
   `providerOptions.openrouter` into the body, and `models` is a supported
   top-level body field (index.mjs: `models: this.settings.models`).
2. **PAYG**: only used as the final fallback when enabled
   (`payg.enabled`) and cost ceilings (`maxCostPerRequestUSD`,
   `maxCostPerMillion*`) pass.

## Consequences
- Free→free failover within OpenRouter is real (server-side).
- PAYG is guarded by cost ceilings and defaults to disabled.
- This is the honest, verified mechanism; no fake per-request cross-provider swap.

## Update (3-item limit)
OpenRouter's native `models` fallback array accepts **AT MOST 3 items**
(live-verified: a 4-item chain returned HTTP 400 "'models' array must have 3
items or fewer."). The chain is now hard-clamped to `OPENROUTER_MODELS_MAX = 3`
in `src/randomize.ts` regardless of config, and `maxFreeModelsPerChain` defaults
to 3 in `config.json`. This is a defensive invariant so a future config edit above
3 can never produce a rejected request.
