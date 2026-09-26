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
| Jev gate model routing (control plane) | `session."model.request"` hook — rewrite model per turn |
| Doctrine / instructions injection | `session.context` hook |
| Compaction guards + runaway-loop fix (`RUNG_CONTEXT_FLOOR`, `isOverflow`) | `session.compaction` hook |
| Tool budget (`decideToolBudget`) | `tool."execute.before"` hook (can reject the call) |
| Permission decisions (`decidePermission`) | `permission` domain hooks |
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
- [ ] **3. Hooks** — model.request (Jev gate), context (doctrine), compaction (guards),
      tool.execute.before (budget), permission. Port control-plane logic from history.
- [ ] **4. Gateway** — `packages/grist-gateway/`, ported from history.
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
