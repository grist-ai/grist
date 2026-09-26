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
- [ ] **5. CLI** — `grist` binary name, always-on plugin loading for the grist binary,
      `grist run` flags. Build script.
- [ ] **6. Identity & docs** — grist.json / `.grist/` (pending his rebrand-patch decision),
      skill, README/docs updates, `patches/` review (v1-era patch-package files).
- [ ] **7. Verify** — typecheck, build, headless `grist run` smoke test under the live Jev
      gate, then the repo test suite.

## Open questions

1. **Plugin auto-load:** how does the `grist` binary guarantee the plugin loads for every
   `grist run` (internal plugin list vs CLI-injected default)? — answer in Phase 5.
2. **Rebrand patch:** his verdict on `grist.json`/`.grist/` (pending) lands in Phase 6.
3. **npm publishing:** `publish-grist.yml` targets v1 package names — rework in Phase 6/7.
4. **Binary distribution:** v2 build/packaging flow (replaces v1 `script/build.ts`) — Phase 5.
