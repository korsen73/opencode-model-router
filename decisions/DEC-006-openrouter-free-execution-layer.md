# DEC-006 — OpenRouter as the dynamic Free execution layer for selected agents

**Status:** Accepted
**Date:** 2026-08-14

## Context
Most agents were pinned to `opencode-go`/`deepseek`. To actually use OpenRouter
Free routing, agents must select an `openrouter/<model>` so the plugin's
`chat.params` chain injection fires (it only fires when providerID ===
"openrouter"). But hard-coding a concrete Free model ID (e.g.
`nvidia/nemotron-nano-12b-v2-vl:free`) in agent config goes stale when OpenRouter
rotates Free models.

## Decision
The plugin's `provider.models()` exposes **stable VIRTUAL routing models** — one
per capability:
- `openrouter/free-coding`
- `openrouter/free-reasoning`
- `openrouter/free-general`
- `openrouter/free-chat`

Each is keyed by its stable virtual ID, and its `api.id` (the actual model sent
to OpenRouter) is set to the router's **current top Free pick** for that
capability (via `topFreePickForCapability`, non-stale, quality-floor,
preferred-filtered, randomized). Agents in `opencode.jsonc` reference the stable
virtual IDs, so config never hard-codes a rotating Free ID.

## Consequences
- Config stays stable across Free-model rotation.
- Primary model tracks the live catalog (refreshed on plugin reload / catalog
  refresh).
- Per-request randomized chain is still injected via `chat.params`.
- **Verified**: `openrouter/free-chat` resolves, reaches OpenRouter, and the
  request uses `api.id` = the current top pick (source: native-request.ts
  `OpenRouter.configure(options).model(api.id)`; empirical: request reached
  OpenRouter and errored on the expected Free upstream).
