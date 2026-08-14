# DEC-008 — Keep Expert on GPT-5.6 Luna

**Status:** Accepted
**Date:** 2026-08-14

## Context
The `expert` agent is the escalation path for unresolved complex problems. It
was pinned to `opencode-go/gpt-5.6-luna` and is intentionally NOT routed through
OpenRouter Free.

## Decision
`expert` remains on `opencode-go/gpt-5.6-luna`. It is the only agent not routed
via OpenRouter Free. Rationale: escalation needs a high-quality, reliable model,
not the cheapest/free path. This is explicitly excluded from the router's agent
set to avoid silently degrading escalation quality on a flaky Free endpoint.

## Consequences
- `expert` is unaffected by Free-model rotation and Free upstream outages.
- All other agents (manager, planner, builder, coder, debugger, tester, quant,
  reviewer, chat) route via OpenRouter Free.
