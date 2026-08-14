# DEC-001 — Separation of roles vs routing

**Status:** Accepted
**Date:** 2026-08-14

## Context
OpenCode agents encode role + model together. The existing setup pins a specific
model (e.g. `opencode-go/deepseek-v4-flash`) to each agent in `opencode.jsonc`.
Free-model discovery and provider failover were hardcoded in agent markdown.

## Decision
Keep **role** (what an agent does) in the agent markdown / agent block, and move
all **model selection** logic into the router under `~/.config/opencode/router/`
(config.json + TypeScript modules). Agent markdown is NOT modified.

## Consequences
- Roles stay readable and stable.
- Routing policy is centralized and tunable in one JSON file.
- No coupling between a role and a specific (possibly unavailable) model.
