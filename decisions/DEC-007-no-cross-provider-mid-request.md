# DEC-007 — No cross-provider mid-request switching in OpenCode 1.18.10

**Status:** Accepted
**Date:** 2026-08-14

## Context
The router decides a provider+model at decision time (Free -> OpenCode Go ->
DeepSeek -> PAYG). Ideally a single request could fail over across providers
mid-flight.

## Decision
**Not possible in OpenCode 1.18.10.** There is no hook that rewrites the
`model`/`provider` identity on the outgoing LLM request. `chat.params` can only
modify `output.options` (e.g. OpenRouter's native `models` fallback array),
`chat.headers`, and params — NOT the primary model/provider.

## Consequences
- TRUE per-request failover is only achievable **within OpenRouter** via its
  server-side `models` chain.
- Cross-provider switching is computed and logged but requires the target to
  already be the request's provider. This is the fundamental, documented
  limitation of the current approach.

## Update (honest empty-chain outcome)
Because of this limitation, when the Free tier is unavailable or yields no
suitable Free model, `decideProvider()` returns an HONEST non-executable
decision: `provider: "free"`, `model: ""`, `chain: []`, `executable: false`,
with a `note` explaining the router's cross-tier preference is diagnostic only.
It does **NOT** claim "opencode-go selected" (that would be a fake fallback that
never executes). The agent stays on its configured `openrouter/free-*` model with
no chain, and the plugin's `chat.params` logs `free-unavailable-no-chain;
cross-provider not possible in 1.18.10` instead of a fake injection. The CLI
`decide` still reports the preferred tier for diagnostics but labels it as not an
automatic mid-request switch. See DEC-004.
