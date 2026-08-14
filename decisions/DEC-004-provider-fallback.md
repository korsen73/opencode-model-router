# DEC-004 — Deterministic provider fallback

**Status:** Accepted
**Date:** 2026-08-14

## Context
OpenCode 1.18.10 has NO hook that rewrites the model/provider identity mid-request.
So dynamic per-request switching across providers (Free -> OpenCode Go -> DeepSeek
-> PAYG) is impossible inside one request.

## Decision
Provider selection is decided **at decision time** (per request, in
`chat.params` / `decide`), using a fixed deterministic order:
`free -> opencode-go -> deepseek/zai -> payg`. Each tier is only selected if its
health state is AVAILABLE and (for payg) cost ceilings pass.

## Consequences
- Deterministic, inspectable fallback order.
- Across-provider switching is **PARTIALLY IMPLEMENTED**: it is computed and
  logged, but the actual mid-request switch requires the target to already be the
  request's provider. True mid-request switching within OpenRouter is achieved via
  the server-side `models` chain (see DEC-005).
