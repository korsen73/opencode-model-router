# DEC-002 — Dynamic Free-model discovery

**Status:** Accepted
**Date:** 2026-08-14

## Context
Free OpenRouter models change frequently (new ones appear, old ones deprecate).
Hardcoding a fixed list goes stale quickly.

## Decision
Discover models dynamically from `https://openrouter.ai/api/v1/models`, cache the
result (`models-cache.json`), and persist a classified registry (`models.json`).
Free-ness is determined **only from the actual pricing fields** returned by the
API (strings like `"prompt": "0"`), never guessed from the model name or `:free`
suffix. Refresh is governed by `discovery.refreshHours`.

## Consequences
- Catalog stays fresh without manual edits.
- Free detection is accurate against real pricing data (verified: 15 free models
  detected from the live API; a naive numeric `=== 0` check found zero because the
  API returns string pricing).
- Unknown capability is marked `unknown` rather than guessed.

## Update (coding classification)
`classifyCapability()` now checks an explicit, metadata-driven **coding signal**
(id/name substrings: code, coder, codex, -code, coding, code-savvy, dev,
north-mini-code) BEFORE the reasoning branch. It no longer treats the
near-universal `supported_parameters: ["reasoning"]` as a strong reasoning
signal; reasoning is now detected from genuine id/name indicators
(reasoning/think/r1). Result: `cohere/north-mini-code:free` (and other code
focused models) classify as **coding** instead of being swallowed by the greedy
reasoning heuristic. Live Free classification moved from
{reasoning:10, general:5, coding:0} to {coding:10, general:5, reasoning:0} among
the 15 Free models. Ambiguous/multimodal models remain general; insufficient
metadata stays unknown.
