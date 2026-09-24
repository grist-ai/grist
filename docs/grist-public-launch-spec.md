# Grist Public Launch Spec — invite-gated, credit-backed, npm-installable

> **SUPERSEDED 2026-09-24.** Grist is now **BYOK**: users bring their own
> provider key (OpenRouter, Vercel AI Gateway, or any OpenAI-compatible
> endpoint) and inference bills to their provider account. The two-token
> invite model below — founder-held OpenRouter key, per-code spend caps —
> no longer applies. `grist_sk_...` keys now identify the *user*; invite
> codes are optional onboarding gating; the Jev gate rides the user's
> provider key. Kept for history; see [README](../README.md) for the
> current shape.

**Status:** spec for build · **Author:** Alfred · **Date:** 2026-09-19
**Companion docs:** `grist-pre-poc-spec-sheet.md` (product decisions), `grist-gtm-doc.md` (positioning)

## 0. Goal

Ship Grist as `npm install <name>` so anyone can try it. For the test period,
all inference is paid from **the founder's own OpenRouter credits**. Access is
gated by **invite codes**: no code, no completions. The public test doubles as
Phase 6 shadow burn-in — real tasks from real users calibrate the Jev gate.

Non-goals for this spec: payments/billing, teams/orgs, self-serve signup.
Those come after the invite test validates the economics. The public site
already shows a dashboard and plan placeholders; beta login is invite-code
only.

## 1. Architecture

```
BROWSER + TESTER'S MACHINE                FOUNDER'S INFRA (Railway)
┌─────────────────────┐                   ┌──────────────────────────────┐
│ Landing / login /   │   same origin     │ GATEWAY                       │
│ dashboard (invite)  │ ────────────────► │  - site: / /login /dashboard  │
│                     │                   │  - invite validation          │
│ npm package (thin   │   invite header   │  - Jev gate (authoritative)   │
│ client): session,   │ ────────────────► │  - per-code spend metering    │
│ tools, TUI LOCAL.   │   SSE stream      │  - OpenRouter proxy (founder  │
│ Only model calls +  │ ◄──────────────── │    key, never leaves server)  │
│ gate scores go out. │                   │  - Langfuse usage events      │
└─────────────────────┘                   └──────────┬───────────────────┘
                                                     │ founder keys
                                                     ▼
                                          OpenRouter · Jev (TypeSafe) · Langfuse
```

**Key principle:** no secret ever ships in the npm tarball. The client holds an
*invite code* (a bearer token); the gateway holds the OpenRouter key, the Jev
key, and the ladder config. Testers never set `OPENROUTER_API_KEY`. Subscription
billing replaces invites later; until then every completion is the founder's
OpenRouter credits, metered per code.

**One client mode:** gateway auth. `grist auth login --provider grist` accepts
a dashboard `grist_sk_...` key or an invite (opens the site). The CLI stores
the credential. `GRIST_GATEWAY_URL` plus `X-Grist-Invite` or `X-Grist-Api-Key`
is how the CLI talks to the gateway. Testers never set `OPENROUTER_API_KEY`.

## 2. npm package

- **Name:** `grist` is TAKEN on npm (old MongoDB package, verified 2026-09-19).
  Candidates: `grist-cli` (check availability at publish time) or scoped
  `@grist-ai/cli`. Founder picks before publish.
- **Rename:** CLI package is currently `@opencode-ai/cli` (deliberate carve-out
  from the fork). Rename to the chosen name; keep the rest of the monorepo
  internal package names unchanged to minimize blast radius.
- **`bin`:** `"bin": { "grist": "./dist/cli.js" }` (adjust to actual entry) so
  `npm i -g <name>` puts `grist` on PATH.
- **Build:** keep the existing TS build pipeline; the published tarball
  contains compiled `dist/` only. `files:` in package.json must exclude
  `.env`, tests, and any fixture containing keys.
- **Publish:** `npm publish --provenance` from CI on version tags. Pre-publish
  checklist: no secrets in tarball (`npm pack --dry-run` review), version bump,
  changelog entry.

## 3. Gateway API contract

Base URL: `https://grist-gateway.<domain>` (Railway). The same origin serves
the public site (`/`, `/login`, `/dashboard`, `/plans`). `GET /health` stays
JSON for Railway. All API endpoints take `X-Grist-Invite: <code>` except
validate and the public pages. Auth failures → `401`; cap-hit → `402` with
a human-readable message the CLI prints verbatim.

Beta access is an invite code — no password, no self-serve signup. After login
the dashboard shows remaining spend and the current Beta plan. Subscription
management is a placeholder until billing lands on this same pipe.

### 3.0 Website
- `GET /` landing. `GET /login` invite form (`POST /v1/invite/validate`).
- `GET /dashboard` usage (calls `GET /v1/usage`). `GET /plans` Beta vs later
  subscription.
- `/health` remains `{ "ok": true }` so the platform health check is not the
  landing page.

### 3.1 `POST /v1/gate/route`
Authoritative Jev scoring (server holds the Jev key).

Request: `{ "text": string, "session_id": string }`
Response:
```json
{
  "rung": "cheapest | medium | frontier",
  "model": { "provider_id": "openrouter", "model_id": "deepseek/deepseek-v4.1-flash" },
  "difficulty": 0.42, "sensitivity": 0.1, "underspecified": 0.05,
  "reasons": ["difficulty_cheapest"],
  "mechanisms": { "observation_pack": true, "action_fusion": true }
}
```
- Ladder mapping (rung → model) lives **server-side** in config, defaulting to
  the settled ladder: cheapest `deepseek/deepseek-v4.1-flash` → medium
  `moonshotai/kimi-k3` → frontier `openai/gpt-5.6-sol`. Founder changes models
  without shipping a client update.
- Sensitivity caps and operating-mode caps applied server-side (load-bearing
  now that it's other people's code).
- Every decision appended to the burn-in JSONL (same schema as the local
  `burn-in` module) for Phase 6 calibration.

### 3.2 `POST /v1/completions`
OpenAI-chat-completions-compatible proxy. Gateway validates the invite code,
checks the code's remaining budget, injects the founder's OpenRouter key, and
streams the SSE response back. Token usage per request is metered to the code.

Request: standard `{ "model": string, "messages": [...], "stream": true, ... }`
plus `X-Grist-Invite` header. `model` must be one of the ladder's current
models — anything else → `400`. (Prevents a leaked code from being used as a
generic cheap OpenRouter proxy.)

### 3.3 `POST /v1/invite/validate`
`{ "code": string }` → `{ "valid": bool, "plan": "beta", "spend_cap_usd": 5,
"remaining_usd": 3.42 }`. Used by the site login, `grist init --invite`, and
client startup.

### 3.3b CLI browser login
`grist auth login` opens `/login?device=<user_code>`. The tester enters their
invite on the site; the CLI polls until that session is bound, then writes
`~/.grist/config.json`. Headless fallback: `grist init --invite`.

- `POST /v1/auth/device` → `{ device_code, user_code, verification_uri, interval, expires_in }`
- `POST /v1/auth/device/approve` `{ user_code, code }` → `{ ok }`
- `POST /v1/auth/device/poll` `{ device_code }` → `{ status: "pending" | "approved", code? }`

### 3.4 `GET /v1/usage`
`X-Grist-Invite` header → `{ "spent_usd": 1.58, "cap_usd": 5,
"remaining_usd": 3.42, "plan": "beta", "expires_at": "...",
"by_rung": { "cheapest": 0.9, "medium": 0.5, "frontier": 0.18 } }`. Powers
`grist usage` and the dashboard.

### 3.5 Admin (founder only, separate auth token, never in the client)
- `POST /v1/admin/invites` `{ "cap_usd": 5, "expires_at": "...", "note": "..." }`
  → `{ "code": "grist-XXXX-XXXX" }`
- `DELETE /v1/admin/invites/:code` — revoke immediately (leak response).
- `GET /v1/admin/usage` — global spend, per-code leaderboard, cap-hit rate.
- `POST /v1/admin/mode` `{ "mode": "normal | capped" }` — global panic button.
  `capped` forces frontier rung off for all codes (spend drops ~90%).

## 4. Client changes (npm package)

1. **Provider:** model calls go through the gateway (`GRIST_GATEWAY_URL` +
   `X-Grist-Invite` from `~/.grist/config.json`). No local OpenRouter key.
   Tools, sandbox, and TUI stay local.
2. **Gate scoring:** `POST /v1/gate/route` (authoritative; server holds Jev).
   If the gateway is unreachable, the client may shadow-score locally but
   completions still require the gateway.
3. **`grist auth login`:** opens the site. Invite on the page authenticates
   the CLI (`~/.grist/config.json`, 0600). `grist init --invite` remains as
   a headless fallback.
4. **`grist usage`:** new command hitting `GET /v1/usage`.
5. **Cap-hit UX:** on `402`, print the server's message + "ask the founder for
   a top-up" — never a stack trace. Degrades, never hard-stops (house rule).

## 5. Invite system

- **Code format:** `grist-XXXX-XXXX` (Crockford base32, no ambiguous chars),
  generated server-side with `crypto.randomBytes`.
- **Storage:** Postgres on Railway (or SQLite file to start — migrate before
  100 codes). Table: `code, cap_usd, spent_usd, expires_at, revoked, note,
  created_at`.
- **Defaults:** $5 cap, 30-day expiry, single-harness use (no sharing clause in
  the invite message).
- **Leak response:** revoke the code (`DELETE /v1/admin/invites/:code`);
  in-flight sessions get 402 on next request. Issue a replacement, don't
  raise the cap.

## 6. Metering, budgets, alerts

- **Per-request accounting:** gateway records input/output tokens × the
  ladder's current per-model prices → USD, added to the code's `spent_usd`.
  Source of truth is the gateway ledger, not Langfuse (Langfuse is analytics).
- **Enforcement:** `spent_usd >= cap_usd` → 402 on next request. No mid-stream
  kills (finish the current turn, then stop).
- **Founder alerts:** notify at 80% of the global test budget and on any
  single code burning >$2 in an hour (abuse signal). Alert channel: founder's
  choice (email/Telegram) — configurable, default email.
- **Suggested global budget for the test:** 50 codes × $5 = **$250**.
  Expected actual burn is far lower (blended ~$1/MTok at 80/15/5 tier mix).

## 7. Security

- Founder keys (OpenRouter, Jev) live in Railway env vars. Never in the repo,
  never in the npm tarball, never in client logs.
- Invite codes are bearer tokens: rate-limit validation attempts (10/min/IP),
  don't enumerate validity (constant-time-ish responses, no "code not found"
  vs "code expired" distinction to strangers).
- Gateway validates `model` against the ladder allowlist on every completion
  request (see §3.2).
- `npm pack --dry-run` in CI with a secret-scan step before every publish.

## 8. Privacy (other people's code now)

- Prompts are other people's proprietary code. Retention policy: burn-in
  logs keep **task text + gate decision + outcome** for calibration (the
  Phase 6 dataset); raw file contents passing through completions are not
  logged beyond what OpenRouter/Langfuse retain per their policies.
- Invite message states plainly: test-period logging exists, what is kept,
  and that testers shouldn't run it on code they can't share.
- Founder's standing opt-out posture applies: no training on tester data,
  no analytics beyond spend/quality aggregates.

## 9. Rollout

- **Phase A — gateway + dogfood:** build gateway, issue 3 codes to self,
  run real tasks for a week. Validates metering, caps, and the 402 UX.
- **Phase B — npm + first testers:** rename, publish, invite 10–20 testers
  ($5 caps). Collect burn-in data + testimonials.
- **Phase C — widen:** up to 50 codes. Freeze client API. The burn-in dataset
  from B+C calibrates gate thresholds (pre-POC §8.6).

## 10. Open questions for the founder

1. npm name: `grist-cli` vs `@grist-ai/cli` (verify availability at publish).
2. Per-code cap: $5 default OK? Global test budget: $250 OK?
3. Burn-in log retention for tester task text: keep (needed for calibration)
   or hash/anonymize?
4. Alert channel for spend/abuse notifications.

## 11. Definition of done

- [x] Gateway + client path: `grist init --invite` → session against the gateway
      (`grist gateway` dogfoods locally; Railway URL still TBD).
- [x] Leaked code revoked via `DELETE /v1/admin/invites/:code`; next request 401.
- [x] Global kill switch `POST /v1/admin/mode` `{ "mode": "capped" }`.
- [x] `grist usage` shows per-code spend by rung.
- [ ] No founder secret present in the published tarball (CI secret-scan).
- [x] Burn-in rows recorded from gateway `/v1/gate/route` decisions.
- [ ] `npm i -g <name>` published (name still open: `grist-cli` vs `@grist-ai/cli`).
- [x] Website: landing, invite login, usage dashboard, plan placeholders.
