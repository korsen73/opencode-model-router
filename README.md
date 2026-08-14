# OpenCode Model Router

A self-contained model-router for OpenCode **1.18.10**. It discovers free
OpenRouter models, classifies their capability, computes a fallback chain, and
injects OpenRouter's native `models` fallback array into the request so requests
fail over server-side. It also observes the actual model used and tracks
locally-observed usage.

> **Read this first.** The router has honest limitations (no mid-request
> cross-provider switching in 1.18.10). Everything automatic vs estimated vs
> manual is called out explicitly at the end.

---

## Currently working / limitation / future

### CURRENTLY WORKING
- Stable virtual routing models exposed by the plugin: `openrouter/free-coding`,
  `openrouter/free-reasoning`, `openrouter/free-general`, `openrouter/free-chat`.
  Each resolves to a **current** top Free model via `api.id`, so agent config
  never hard-codes a rotating Free model ID. **Verified**: `api.id` controls the
  actual request model (source `native-request.ts` `OpenRouter.configure(options)
  .model(api.id)`; empirical: `openrouter/free-chat` reached OpenRouter and hit
  the expected Free upstream).
- Per-request randomized Free fallback chain is injected via `chat.params` →
  `output.options.models` (OpenRouter server-side `models` array). Verified.
- Actual model+provider+cost observed via the `event` hook and logged.
- Coding Free models are correctly classified (explicit coding signal before the
  reasoning heuristic). `cohere/north-mini-code:free` is now coding; 10 of 15
  Free models classify as coding.
- **Live HTTP 200 verified**: a direct OpenRouter Free request
  (`openai/gpt-oss-20b:free` via the `models[]` chain) returned HTTP 200, content
  "OK", cost $0. Confirms the OpenRouter server-side fallback executes.

### CURRENT LIMITATION
- No mid-request cross-provider switching in OpenCode 1.18.10 (DEC-007). True
  failover is only within OpenRouter. When Free is unavailable/no chain, the
  decision is **non-executable** (`executable:false`): the agent stays on its
  configured `openrouter/free-*` model with NO chain and NO fake fallback is
  logged (honest `free-unavailable-no-chain` entry instead).
- OpenRouter Free upstreams are frequently rate-limited / timing out (observed
  502/504). The chain helps, but the Free tier is not guaranteed-reliable.
- The running desktop app (OpenCode.app) may hold a stale config/server cache; a
  CLI `opencode run` can route to the old config until the server restarts.

### FUTURE
- Refresh virtual models periodically (not just at plugin load / catalog refresh).
- Health-based Free upstream selection before building the chain.
- A dedicated small-model routing path for titles/summaries.

## Architecture

```
~/.config/opencode/router/
  models.json            persistent registry (discovered/approved/disabled/stale)
  models-cache.json      raw OpenRouter catalog cache
  status.json            provider/model health + cooldowns
  usage.json             locally-observed per-provider counters (daily reset)
  logs/routing.log       structured routing log lines
  decisions/             DEC-001..DEC-008
  src/                   TypeScript modules (see below)
  tests/                 node:test unit tests (mock all HTTP)
  cli.mjs                status | refresh-models | diagnostics | decide <agent>

~/.config/opencode/plugins/
  router-plugin.ts       the plugin (provider.models, chat.params, event, tools)
```

### Source modules
| Module | Purpose |
|---|---|
| `src/discover.ts` | OpenRouter `/models` fetch + cache + staleness |
| `src/filter.ts` | Free detection (from real pricing), capability, quality floor |
| `src/classify.ts` | Capability classification + local override file |
| `src/preferences.ts` | Preferred-model whitelist filtering |
| `src/randomize.ts` | Fisher-Yates unbiased shuffle, on/off, max chain |
| `src/fallback.ts` | Build OpenRouter `models` chain + provider-tier decision |
| `src/health.ts` | Provider/model health + cooldowns |
| `src/cost.ts` | Cost ceiling checks |
| `src/usage.ts` | Locally-observed counters + daily reset |
| `src/log.ts` | Structured log writer |
| `src/router.ts` | Orchestrator entrypoint (subcommands + shared logic) |
| `src/types.ts` | Shared types |

---

## Install

The plugin lives in `~/.config/opencode/plugins/` which OpenCode auto-loads at
startup (verified). The 9 routed agents in `opencode.jsonc` point at the stable
virtual routing models:
- manager / planner / quant / reviewer → `openrouter/free-reasoning`
- builder / coder / debugger / tester → `openrouter/free-coding`
- chat → `openrouter/free-chat`
- expert → stays `opencode-go/gpt-5.6-luna` (unchanged)

```bash
# If needed, install test/typescript deps:
cd ~/.config/opencode/router && npm install

# Refresh the catalog from OpenRouter (needs OPENROUTER_API_KEY):
node cli.mjs refresh-models
node cli.mjs status
node cli.mjs decide coder
```

## Config (`config.json`)

- `providerOrder`: `["free","opencode-go","deepseek/zai","payg"]`
- `randomizeFreeModels` (default `true`), `maxFreeModelsPerChain` (default `4`)
- `freeModelCooldownSeconds` (default `300`)
- `discovery`: url, `refreshHours` (default `24`), `apiKeyEnv`, `timeoutMs`
- `dailyReset`: `{hour, minute}` local-timezone reset
- `payg`: `enabled` (default `false`), `maxCostPerMillionInput/Output`,
  `maxCostPerRequestUSD` (default `0.10`)
- `capabilities`: per-capability `{minContext, tools, preferred[]}`. `preferred`
  entries are **name-substring hints** filtered against the live catalog; they
  are never assumed to exist.
- `agentCapability`: agent → capability mapping
- `qualityFloor`: global `{minContext, tools}`
- `providers`: provider tier → real providerID mapping
- `providerHealth`: initial health defaults per tier

**Routing logic lives in config, NOT in agent markdown.**

## Env vars
- `OPENROUTER_API_KEY` — used for catalog discovery and (via opencode config) for
  OpenRouter requests. **No keys are hard-coded or logged anywhere.**
- `ROUTER_DIR` (optional) — override router base dir (used by tests).

## Providers
| Tier | providerID | Notes |
|---|---|---|
| `free` | `openrouter` | OpenRouter free endpoints |
| `opencode-go` | `opencode-go` | OpenCode's free proxy tier |
| `deepseek/zai` | `deepseek` | Direct provider (needs key; currently CONFIGURATION_ERROR) |
| `payg` | `openrouter` | OpenRouter paid; disabled by default |

## Capability mapping
Auto-classified from metadata. **Coding** is detected first via an explicit
id/name code signal (code, coder, codex, -code, coding, code-savvy, dev,
north-mini-code) — e.g. `cohere/north-mini-code:free`. **Reasoning** is detected
from genuine id/name indicators (reasoning / think / r1); the near-universal
`supported_parameters:["reasoning"]` flag is NOT treated as a specialization.
**General** = multimodal. **Unknown** = insufficient metadata (never guessed).
Overridable via `classify-overrides.json`.

## Free discovery
Free is determined **only** from actual pricing fields. The live API returns
pricing as strings (e.g. `"prompt": "0"`), so numeric-string coercion is used.
Verified: 15 free models detected from the live catalog.

## Randomization
Fisher-Yates unbiased shuffle over the Free pool only (when enabled), truncated to
`maxFreeModelsPerChain`. Verified unbiased and duplicate-free by unit tests.

## Fallback logic
1. Free tier → randomized chain of free models (OpenRouter server-side failover).
2. If Free is unavailable or yields no suitable chain, the decision is **not
   executable** (`executable:false`). No cross-provider switch is attempted:
   `opencode-go`/DeepSeek/PAYG are NOT auto-selected mid-request (impossible in
   1.18.10). The CLI `decide` reports the cross-tier preference in a `note` but
   labels it diagnostic only. See DEC-007.
3. PAYG remains disabled and is never auto-triggered.

## Health states
`AVAILABLE`, `TEMPORARILY_UNAVAILABLE`, `EXHAUSTED`, `DISABLED`,
`CONFIGURATION_ERROR`, `UNKNOWN`. Cooldowns flip a provider to
`TEMPORARILY_UNAVAILABLE` until expiry.

## Logging
`logs/routing.log` — one JSON line per routing event: timestamp, agent,
capability, selected provider/model, chain, actual model, reason, cost, isFree,
didFallback. **Never logs keys/credentials.**

## Usage tracking
`usage.json` — locally-observed per-provider counters (requests, input/output
tokens, estimated cost). **These are LOCALLY-OBSERVED estimates, NOT official
quota.** Daily reset in local timezone.

---

## Testing

```bash
cd ~/.config/opencode/router && npm test        # node --test tests/
npx tsc --noEmit                                # type check
```

All HTTP is mocked (injected fake fetch). Integration tests that hit real APIs are
opt-in via env flag and are NOT enabled by default.

18 base cases + 10 integration cases covered (see `tests/`):
1. Free model detection (from pricing, not name)
2. Capability classification
3. Preferred-model filtering
4. Fisher-Yates unbiased + no duplicates
5. Fallback ordering
6. Provider health states
7. Cooldown behavior
8. Cost ceiling
9. Unknown quota handling
10. Stale model registry
11. OpenRouter API failure (stale-cache fallback)
12. Direct provider failure
13. OpenCode Go unavailable
14. Final PAYG fallback
15. Credential missing
16. No suitable Free model
17. All providers unavailable

Integration (I1-I10):
- I1: per-agent capability → OpenRouter Free chain (manager/planner/builder/
  coder/debugger/tester/quant/reviewer/chat)
- I2: expert stays on `opencode-go/gpt-5.6-luna`
- I3: no agent `.md` hard-codes Free model IDs
- I4: chain ≤ 4 and no duplicates
- I5: randomization produces varied primaries
- I6: unsuitable models excluded (below floor / paid / meta-routing)
- I7: `topFreePickForCapability` returns a valid current Free model
- I8: routed agents use stable virtual IDs; expert fixed; PAYG disabled
- I9: reviewer and coder draw from different capability pools
- I10: no suitable Free model does not trigger PAYG

## Troubleshooting
- **No free models found**: run `node cli.mjs refresh-models`; check the OpenRouter
  API returns string pricing (it does).
- **Agent always uses opencode-go**: the free tier is unavailable (health/registry
  empty). Refresh the catalog and confirm `free` health is AVAILABLE.
- **chat.params not injecting**: only fires for the `openrouter` provider. The
  `input.provider` object carries `.id` (not `.info.id`) in 1.18.10.
- **CLI run still uses old agent model (e.g. deepseek-v4-flash)**: a running
  OpenCode desktop app may hold a stale config/server cache. Restart it (or use
  an explicit `--model openrouter/free-<cap>` override) to pick up config changes.
- **OpenRouter Free 502/504**: Free upstreams are frequently exhausted; the
  fallback chain handles failover, but transient failures are expected. Cooldown
  is applied on error to avoid hammering.

## Known OpenCode limitations
- **No mid-request cross-provider switching** (1.18.10). Only OpenRouter's
  server-side `models` chain gives true per-request failover, and only within
  OpenRouter. Documented in DEC-004/005.

---

## WHAT-IS-AUTOMATIC vs ESTIMATED vs REQUIRES-MANUAL

### Automatic (works out of the box)
- Dynamic Free-model discovery + Free detection from real pricing.
- Capability classification (with `unknown` fallback).
- Fisher-Yates randomization of the Free chain.
- Stable virtual routing models (`openrouter/free-<capability>`) whose `api.id`
  tracks the current top Free model (no hard-coded rotating IDs).
- OpenRouter `models` fallback-chain injection via `chat.params` → body.
- Actual-model observation (via `event` hook) + routing logs + usage counters.
- The 9 routed agents (manager/planner/builder/coder/debugger/tester/quant/
  reviewer/chat) are already wired to the virtual models; expert stays fixed.

### Estimated / locally-observed (NOT authoritative)
- Usage counters and per-request cost in `usage.json` / `logs/routing.log`.
- Provider health state transitions and cooldowns are locally inferred.
- These are explicitly labeled ESTIMATED / locally-observed, never official quota.

### Requires manual configuration
- API keys (only `OPENROUTER_API_KEY` is set; DeepSeek/Z.ai need keys).
- `payg.enabled` (off by default) and PAYG cost ceilings.
- `classify-overrides.json` if auto-classification misjudges a model.
- Adjusting `config.json` tunables (refresh hours, cooldown, chain length,
  preferred-model hints).
- Restarting a running OpenCode desktop app after config changes (it may cache the
  old config/server state).
- Re-pointing any future agent to `openrouter/free-<capability>` if it should route
  via OpenRouter Free (chain injection only fires for the `openrouter` provider).
