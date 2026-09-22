# Grist production-readiness fix spec — Grist fixing itself

**Date:** 2026-09-21 · **Repo:** `~/workspace/grist-work/grist` (snapshot of `pranav6226/grist@main`)
**Branch:** create `fix/prod-readiness`, commit at each phase boundary. **Do NOT push** (no remote configured on this machine).
**Scope boundary:** touch ONLY `packages/opencode/src/grist/`, `packages/opencode/src/cli/cmd/`,
`.github/workflows/publish-grist.yml`, `packages/opencode/Dockerfile.gateway`, and `docs/`
(for one documentation decision). Do not modify any other opencode packages — this repo is a
fork and the base must stay clean.

## Context

Grist is a confidence-gated coding-agent harness. Money path: the CLI (`grist run`) talks to
a founder-hosted gateway (`packages/opencode/src/grist/gateway/`), which proxies to OpenRouter
with the founder's key and meters spend per account against a $5 cap. Auth is per-account API
keys (`grist_sk_...`, stored hash-only); onboarding via single-use invite codes.

**Hard rules (non-negotiable):**
1. Upstream model identities NEVER surface to users — CLI output, `-m` flag, logs, errors,
   proxied responses speak rung names only (`cheapest` / `medium` / `frontier`).
2. Ladder mapping (rung → upstream model) lives server-side. The shipped client binary must
   not contain upstream model IDs.
3. Metering must be trustworthy — the product's pitch is cost receipts. Every receipt must
   reflect what the founder actually pays upstream.

**Authoritative prices (verified 2026-09-21):**
- `deepseek/deepseek-v4.1-flash`: $0.15/$0.60 per 1M tokens **off-peak**, $0.30/$1.20 **peak**
  (time-of-day; find the exact peak window — check repo docs, else DeepSeek/OpenRouter docs.
  If you cannot confirm the window, implement `isPeakHourUTC()` with a clearly-marked
  `PEAK_HOURS_UTC` constant default and flag it prominently in your report. Do not guess silently.)
- `moonshotai/kimi-k3`: $3/$15 headline, **cached input $0.30/M** (via
  `usage.prompt_tokens_details.cached_tokens`)
- `openai/gpt-5.6-sol`: $4/$20 promo through **2026-11-21**, then $5/$30

## Phase A — money-path blockers (gateway)

**A1. Fix the price table** (`packages/opencode/src/grist/gateway/prices.ts:5-7`).
Current: flat `0.15/0.60`, `3/15`, `4/20` via `usdForUsage` (prices.ts:49-53). Wrong three ways —
see prices above. Implement: peak/off-peak lookup for Flash, `cachedInput: 0.30` for Kimi
(parsed from `usage.prompt_tokens_details.cached_tokens` in `usageFromUnknown`, http.ts ~706,
which currently reads only `prompt_tokens`/`completion_tokens`), and an effective-date price
table for Sol (4/20 until 2026-11-21, 5/30 after). Update the header date comment. Add/extend
unit tests covering: peak vs off-peak billing, cached-token split, pre/post 2026-11-21 Sol pricing.

**A2. Atomic spend-cap enforcement** (`http.ts:330` check, `store.ts:163,274` `addSpend`).
Current: `if (invite.spent_usd >= invite.cap_usd) return capHit(invite)` on an auth-time row
read, then unconditional `UPDATE invites SET spent_usd = spent_usd + ?` after the upstream
`await` — N concurrent requests all pass the check. Fix: single statement
`UPDATE invites SET spent_usd = spent_usd + ? WHERE code = ? AND spent_usd + ? <= cap_usd`,
return 402 when `changes === 0`. Apply to both the JSON and streaming (`meteredSse` →
`meterFromUsage`) paths. Spec intent ("402 on next request, no mid-stream kills") stays.

**A3. Enforce `capped` panic mode in `completions`** (`http.ts:323-375`).
Current: `store.getMode()` is read only in `gateRoute` (line 294); `POST /v1/completions`
with a frontier model succeeds in `capped` mode. Fix: after the model-allowlist check, read
the mode and clamp — `capped` + frontier → remap to the medium upstream id (or 400 with a
clear message). Test: capped mode blocks frontier completions, allows cheapest.

**A4. Meter and rate-limit `/v1/gate/route`; bound request bodies.**
Current: `scoreTask(...)` (http.ts:293) is a paid Jev call per request — never metered via
`addSpend`, no rate limit, and `readJson` (http.ts:747) does unbounded `await req.text()` on
every endpoint. Fix: (a) rate-limit gate/route per account/IP; (b) debit a flat per-call cost
via `addSpend` (or require cap headroom before calling); (c) enforce `Content-Length` caps
before `req.text()` — e.g. 256KB for completions, 8KB for gate/route text — with 413 on
exceed. Apply (c) to all JSON endpoints.

**A5. Stop forwarding arbitrary client fields upstream** (`http.ts:344`
`const payload = { ...body, model: upstreamModel }`). Clients can smuggle `provider`
(force most-expensive OpenRouter provider), `max_tokens`, `models` (fallback lists),
`reasoning`, `plugins` — the gateway eats the cost difference vs the metered ladder price.
Fix: whitelist forwarded fields (`messages`, `temperature`, `top_p`, `stream`, `tools`, …)
and enforce a server-side `max_tokens` ceiling.

**A6. Per-key spend attribution + index** (`store.ts:102-111`, `store.ts:255`,
`http.ts:622-644`). Current: `usage_events` has no `key_id`; `addSpend` doesn't accept one;
the $2/hr abuse alert runs per-account not per-key. Fix: add `key_id TEXT` to
`usage_events`, thread the key id from `resolveInvite` through `meterFromUsage` into
`addSpend`, and add `CREATE INDEX usage_events_code_at ON usage_events(code, at)` (the
per-request `spendSince` SUM scan is currently unindexed).

**A7. Meter streaming disconnects** (`http.ts:664-700` `meteredSse`). Current:
`meterFromUsage` runs only when `chunk.done` arrives in `pull()` — client disconnect or
mid-stream upstream error = free compute. Fix: wrap the `pull` body in try/finally metering
whatever `usage` was captured, and/or meter in the stream's `cancel()` callback.

## Phase B — identity, publish, hardening

**B1. Enforce rung-names-only on every user-visible surface.**
- `packages/opencode/src/cli/cmd/run.ts:165-169` + `pick()` (run.ts:31-38): `-m` help says
  "provider/model" and passes anything through. Validate against
  `["cheapest","medium","frontier"]`; update help text.
- `packages/opencode/src/cli/cmd/models.ts:25`: `grist models` prints the full models.dev
  catalog including upstream IDs. Filter to ladder rungs (keep it clearly internal).
- `packages/opencode/src/grist/brand.ts:11`: `HIDE_MODEL_UI = true` is defined but never
  consumed — wire it into the TUI model picker or delete it; either way the picker must
  show rungs only.
- `packages/opencode/src/grist/rung.ts:15-30`: `RUNG_MODELS` upstream defaults are
  compiled into the client binary (extractable via `strings`). Move upstream defaults into
  a gateway-only module; the client keeps only rung names / `publicModelRef`.

**B2. Harden the publish workflow** (`.github/workflows/publish-grist.yml`).
Add `--provenance` to `npm publish` (line 84; OIDC `id-token: write` is already set), add a
pre-publish secret-scan step (gitleaks or equivalent, fails the job on hits), and add a
`push: tags:` trigger — or document the manual-`workflow_dispatch`-only decision in the file.
Verify `script/publish.ts` / `script/build.ts` (not present in the review snapshot — check
in-repo) enforce a tarball allowlist excluding `.env`, tests, and fixtures containing keys.

**B3. Complete rate limiting** (`http.ts:142,192,216,273,493`). `allowValidate`
(10 req/60s/IP) covers invite-validate/device-approve/firebase-bind/access-requests but NOT
key minting (`POST /v1/api-keys` — spec: 10/hr/account), `/v1/completions`, `/v1/gate/route`,
or `POST /v1/auth/device`. Add per-account/per-IP windows. Also `clientIp` (http.ts ~890)
trusts `X-Forwarded-For` unconditionally — only trust it from known proxies, else use the
socket remote IP.

**B4. Admin auth: token required, always** (`http.ts:561-575`). Current `requireAdmin`
succeeds on `X-Grist-Admin === adminToken` OR a Firebase session matching the admin email —
compromising the founder's Google account alone yields full admin. Require the admin token
always; Firebase may serve as a second factor, not an alternative. Move
`DEFAULT_ADMIN_EMAIL` (http.ts:28) to env-only.

**B5. Stop leaking invite codes to the alert webhook** (`http.ts:660-668` `maybeAlert`
sends `` `code ${invite.code} burned $...` ``). Invite codes are bearer credentials. Alert
on a prefix/fingerprint only.

**B6. Make invite binding atomic and decide single-use** (`store.ts:360-370`
`bindAccount`). Concurrent double-binds race check-then-insert → unhandled 500. Use
`INSERT … ON CONFLICT DO NOTHING` + clean 409. Then decide per the launch spec ("single-use
expiring onboarding tokens"): revoke/consume the invite code after successful bind, and
implement it.

**B7. Container hygiene** (`packages/opencode/Dockerfile.gateway`). Add a non-root `USER`
and a `HEALTHCHECK`. (Image is otherwise sound — gateway imports are stdlib-only.)

**B8. Upstream timeouts** (`http.ts:349-357` `fetchImpl`, plus Firebase lookups). Add
`AbortSignal.timeout(120_000)` — a hung upstream currently pins the handler forever.

**B9. Billing systems decision** (`packages/console/core/src/billing.ts` vs the gateway
SQLite ledger). The console Stripe credit model is inherited opencode weight; the launch
spec says the gateway ledger is source of truth. Do not wire both live — write the decision
into `docs/grist-public-launch-spec.md` (or a short `docs/billing-decision.md`): which
system collects money at launch and what happens to the other.

## Phase C — wire the gate into `grist run`

The server exposes authoritative gating (`POST /v1/gate/route` → `scoreTask`), but the
client never calls it — routing today is just `-m` / config default through the proxy.
In gateway mode, `grist run` must call `/v1/gate/route` with the task text before model
selection and use the returned rung's public model id for the completions call. `-m` with
an explicit rung remains an override. Acceptance: a gateway-mode run produces a burn-in
entry from the gate decision server-side. Also reconcile `PUBLIC_RUNG_NAME`
(`rung.ts:34-38`: Fast/Standard/Max) with `usage.ts:22-24` (lowercase) — one source of
truth, no new names invented.

## Verification (every phase)

- Run the repo's tests for every touched module with bun
  (`gateway/http.test.ts`, `rung.test.ts`, `jev-gate.test.ts`, `invite/config.test.ts`,
  CLI tests incl. `test/cli/grist-auth-login.test.ts`). All green before committing the phase.
- Typecheck passes (repo's configured `tsc` / build).
- Commit per phase with clear messages on `fix/prod-readiness`.

## Report back

For each phase: files changed, tests run + results, and anything you could NOT verify or
had to decide (e.g. the DeepSeek peak window, the B6 single-use decision, the B9 billing
decision). Flag any spec item you believe is wrong after reading the code.
