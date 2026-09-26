# Grist v2 Migration Plan

**Branch:** `v2-migration` · **Base:** upstream `anomalyco/opencode` tag `v2.0.9`
**Status:** Phase 1 done (clean tree). Nothing merges to `main` without his word.

## Strategy

**Plugin, not fork.** v2 is a different architecture (30 scoped packages, client/server
split, first-class plugin SDK). Porting Grist's ~20 surgical v1 edits file-by-file is
wrong — the files don't exist in the same form. Instead Grist becomes a **v2 plugin**
(`packages/grist/`) plus its gateway service. Prize: no more fork diff to carry; future
upstream updates are plain tag merges.

## v1 → v2 mapping

| Grist v1 (surgical edit) | Grist v2 (plugin) |
|---|---|
| `ensureGristLadderModels` injected into provider loading | Provider plugin: `ctx.provider.add()` a `grist` provider with the 4 rung models (cheapest/medium/frontier/premium), routed to the gateway |
| Jev gate model routing (control plane) | `session.prompt` hook — routeTask, then `session.switchModel` to the gated rung (non-pinned sessions) |
| Between-turn judgment (escalate) | `session."model.request"` hook (primary, step>1) — escalate via `session.switchModel`; stop not acted on (heuristics removed by his order) |
| Doctrine / instructions injection | `session.context` hook |
| Compaction guards + runaway-loop fix (`RUNG_CONTEXT_FLOOR`, `isOverflow`) | `session.compaction` hook (logging guard; floors in rung model definitions are the fix) |
| Tool budget (`decideToolBudget`) | `tool."execute.before"` hook (rejects the call with `Tool.Error`) |
| Tool stats + post-edit verify nudge | `tool."execute.after"` hook |
| Permission decisions (`decidePermission`) | `permission.evaluate` hook (auto-allow only) |
| `src/grist/gateway/` (own HTTP service) | `packages/grist-gateway/` — port as-is, fix imports |
| `grist run` headless | v2 `runV1Bridge` keeps `opencode run` CLI compat — verify `grist run` end-to-end |
| `.agents/skills/typesafe-ai/` | moves over unchanged |

Business logic ports from git history (`95b2e0c0:packages/opencode/src/grist/`):
Jev client, rung definitions, gateway client, thresholds, doctrine text, burn-in.

## Phases

- [x] **1. Tree** — branch `v2-migration` from `main` (95b2e0c0); tree replaced with
      upstream `anomalyco/opencode` v2.0.9 in a single import commit (605884d1).
      (A merge with `--allow-unrelated-histories` was tried first but the shallow
      upstream fetch broke the push; the single-commit import pushes cleanly.
      Future upstream updates re-import the same way.)
- [x] **2. Plugin scaffold** — `packages/grist/` (`@grist-ai/plugin`) created and typechecking:
  `grist-ai.plugin` adds the `grist` provider (openai-compatible transport at the
  gateway URL, gateway auth headers) with the 4 ladder rungs as models, using the
  per-rung context floors. Inert without an invite config. (folded into 605884d1)
- [x] **3. Hooks** — `session.prompt` (Jev gate → switchModel), `session.context`
      (doctrine), `session."model.request"` (between-turn judgment; escalate only —
      stop heuristics stay removed per his order), `session.compaction` (logging guard;
      the runaway fix lives in the Phase 2 rung floors), `tool.execute.before` (budget
      → Tool.Error), `tool.execute.after` (tool stats + verify nudge), `permission.evaluate`
      (auto-allow). Ported: jev-gate, control-plane (minus rankContextNodes → code-map port),
      doctrine, mechanisms, mode, thresholds, jev-client, jev-route, burn-in, usage-log, debug.
      Gateway gate deferred to Phase 4. Hooks active with shadow fallbacks when no Jev
      route resolves; `GRIST_CTRL=off` disables. Typecheck clean; shadow-path smoke green.
- [x] **4. Gateway** — `packages/grist-gateway/` (`@grist-ai/gateway`) ported from history
      with its 4 test files and the served `site/` landing page: `Bun.serve` + `bun:sqlite`
      store, `/v1/gate/route`, `/v1/completions`, `/v1/chat/completions`, `/v1/provider`
      (BYOK attach), `/v1/api-keys`, `/v1/usage`, `/v1/account/cap`, device-flow auth,
      Firebase ID-token verify (REST, no admin SDK), invite/admin APIs. Shared logic
      factored into **`packages/grist-logic/` (`@grist-ai/logic`)** — rung, mode,
      thresholds, mechanisms, jev-client, jev-route, jev-gate, control-plane, doctrine,
      debug, burn-in, usage-log, invite-config, invite-client, codes — consumed by both
      the plugin (thin: plugin.ts + hooks.ts) and the gateway. The gateway gate
      (`routeViaGateway` via `fetchGateRoute`) is restored in jev-gate: invite present →
      remote route, 402 rethrown, other failures fall back to local shadow. Verified:
      typecheck clean ×3, 101/101 gateway tests, live boot + admin invite mint +
      `/v1/gate/route` E2E and client `routeTask` → `via gateway/shadow`.
      (Railway deploy wiring is Phase 6.)
- [x] **5. CLI** — `grist` binary name, always-on plugin loading for the grist binary,
      `grist run` flags. Build script.
      Injection answer: `packages/core/src/location-services.ts` gained an additive
      `registerInstancePlugin()` registry (no behavior change when empty); the grist
      binary registers `@grist-ai/plugin` at startup in `packages/cli/src/index.ts`,
      gated on the `GRIST_BINARY` build define — so every instance is born with the
      plugin and no user config is needed. No other upstream core edits.
      `packages/grist/script/build.ts` compiles the v2 CLI single-file as `grist`
      (headless: web-UI embed stubbed, pty binary embedded like the main build;
      needs `bun install --os="*" --cpu="*"` first). `grist run` flags all present
      (`--session/-s`, `--format`, `--model/-m`, `--continue/-c`, `--file/-f`,
      `--agent`, `--title`, `--thinking`; v2 has no `--dir` — run from the cwd).
      Verified: typecheck clean (core, cli), binary boots as `grist v0.0.0`,
      headless `grist run` smoke under the live Jev gate returned on
      `grist/cheapest` (session export: `providerID: "grist"`, `model.id: "cheapest"`).
      (The 136M `dist/grist` build output is git-ignored; replacing the live
      installed binary is Phase 7.)
- [x] **6. Identity & docs** — DONE 2026-09-26:
  - Railway deploy wiring: `packages/grist-gateway/Dockerfile` (multi-stage; bun
    build bundles gateway+logic to one file, non-root `grist` user via su-exec,
    `/data` volume, `/health` healthcheck) + `entrypoint.sh`; root
    `railway.json` now points at it. Bundle layout verified live
    (health 200, landing page 200).
  - Skill: `skills/grist/SKILL.md` rewritten for v2 (no `--dir` — cd first; no
    `-m` pin — Jev gate decides; auth via `GRIST_API_KEY`/`~/.grist/config.json`;
    spend check via `/v1/usage`; `< /dev/null` gotcha), bumped to 0.2.0.
    `packages/grist-gateway/site/grist-skill.md` is now a symlink to the
    canonical skill (Dockerfile materializes it); landing-page skill tests pass.
  - `patches/`: removed 9 unreferenced v1-era patch files (target versions
    absent from the v2 lockfile); now matches upstream v2.0.9 exactly.
  - `publish-grist.yml` reworked for v2: `packages/grist/script/build.ts`
    gained `--all-targets` (8 platform binaries + platform package.jsons into
    `dist/grist-<os>-<arch>[-musl]/`); new `packages/grist/script/publish.ts`
    stages the `grist-ai` wrapper (reuses upstream postinstall.mjs for
    musl/glibc selection), stages `@grist-ai/grist-skills`, skip-if-published,
    forbidden-file gate, `--provenance` in CI. Prepare flow verified with stub
    dist. Manual-dispatch + gitleaks + OIDC guardrails kept; version input now
    required (no auto-bump).
  - README.md rewritten for the v2 plugin architecture (ladder table with
    checked-in prices, quickstart, hook inventory, repo layout, dev commands).
  - Still pending his verdict: `grist.json`/`.grist/` rebrand patch.
- [x] **7. Verify** — DONE 2026-09-26:
  - Typecheck clean: `packages/grist`, `packages/grist-gateway`,
    `packages/grist-logic`, `packages/cli`, `packages/core`. (Phase 7 caught a
    trailing comma in `packages/grist/package.json` — bun tolerates it but
    tsgo's strict package.json parsing doesn't; it surfaced as a confusing
    `TS2307: Cannot find module '@grist-ai/plugin'` in `packages/cli`. Fixed.)
  - Build: restructured `script/build.ts` produces a working 142MB binary
    (`packages/grist/dist/` is git-ignored).
  - Headless smoke under the live Jev gate: `grist run --format json "Reply
    with exactly: ok"` from a clean cwd → exit 0, session
    `ses_f20cf18a3ffeFdCTMl6PvWorWQ` ran on `grist/cheapest` (gate routed).
  - Tests: gateway 101/101, skill 3/3, core location-layer+activity 28/28
    (2 pre-existing skips). Full upstream tree suite not run (VM too slow;
    migration blast radius is the two touched upstream files, both covered).

## Open questions

1. **Plugin auto-load:** how does the `grist` binary guarantee the plugin loads for every
   `grist run` (internal plugin list vs CLI-injected default)? — answer in Phase 5.
2. **Rebrand patch:** his verdict on `grist.json`/`.grist/` (pending) lands in Phase 6.
3. **npm publishing:** `publish-grist.yml` targets v1 package names — rework in Phase 6/7.
4. **Binary distribution:** v2 build/packaging flow (replaces v1 `script/build.ts`) — Phase 5.
