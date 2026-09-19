# Upstream pin

Grist’s agent-loop tree was reset from [anomalyco/opencode](https://github.com/anomalyco/opencode) branch `dev` at commit `5f9d918` (shallow clone at reset time).

Default branch for this fork is **`main`** (upstream OpenCode uses `dev`). CI workflows are remapped to `main` and GitHub-hosted runners — Blacksmith labels from upstream are not available here.

The upstream `generate` workflow (OpenCode GitHub App auto-commit) is `workflow_dispatch` only until `OPENCODE_APP_ID` / `OPENCODE_APP_SECRET` are configured.

The `test` workflow runs **Grist-scoped** checks only (`packages/opencode` `src/grist/` tests + opencode typecheck). The full upstream `bun turbo test` + app e2e matrix is not enabled here — it OOMs/timeouts on github-hosted runners without Blacksmith.
