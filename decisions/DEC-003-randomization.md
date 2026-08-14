# DEC-003 — Randomization only within Free models

**Status:** Accepted
**Date:** 2026-08-14

## Context
OpenRouter Free endpoints are often rate-limited / exhausted by different users.
Concentrating all requests on one free model causes 429s; but the paid tail must
remain deterministic (cost-controlled).

## Decision
Apply Fisher-Yates unbiased shuffling ONLY to the Free pool when
`randomizeFreeModels` is true. The chain is then: `[randomized free prefix]`
(up to `maxFreeModelsPerChain`) followed by a deterministic paid tail. OpenRouter
executes the chain server-side and fails over within the chain.

## Consequences
- Free load is spread across models, reducing per-model exhaustion.
- Paid selection stays deterministic and cost-predictable.
- Shuffle is unbiased (verified by distribution test) and duplicate-free.
