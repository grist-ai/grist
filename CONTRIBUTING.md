# Contributing to Grist

Grist is a confidence-gated coding-agent harness, forked from
[OpenCode](https://github.com/anomalyco/opencode). We welcome bug fixes,
provider additions, gate/ladder improvements, docs, and environment-quirk fixes.

Core product features go through a design review with the maintainer before
implementation — open an issue first.

## Ground rules

- **Branch names:** short, ≤3 hyphenated words, no slashes or type prefixes
  (`session-recovery`, not `feat/session-recovery`).
- **Commits:** conventional style — `feat(scope): summary`, `fix: ...`,
  `docs: ...`, `chore: ...`, `refactor: ...`, `test: ...`.
- **Merging:** nothing merges to `main` without the maintainer's explicit word.
  Push branches freely; "pushed" is not "merged" is not "live".
- **Style:** follow [`AGENTS.md`](AGENTS.md) — no `else`, `const` over `let`,
  functional array methods, no `any`, Bun APIs, no aliased/star imports.
- **Rung names only:** never surface upstream model identities to users in
  UI, logs, or docs. The ladder's models are internal config.
- **No AI-generated walls of text** in PRs or issues. Write short, focused
  descriptions in your own words.

## Developing Grist

- Requirements: Bun ^1.3.14 (`packageManager` field enforces this).
- From the repo root:

  ```bash
  bun install
  bun dev            # TUI against packages/opencode
  ```

- Run the headless server: `bun dev serve` (port 4096 default).
- Build a standalone binary: `./packages/opencode/script/build.ts --single`,
  then `./packages/opencode/dist/opencode-<platform>/bin/opencode`
  (replace `<platform>`, e.g. `darwin-arm64`, `linux-x64`).

Key packages: `packages/opencode` (core logic, CLI, server, gateway),
`packages/app` (shared web UI), `packages/desktop` (Electron app),
`packages/route-graph` (Express route-registration extractor).

### Typecheck & tests

- Typecheck from package dirs: `cd packages/opencode && bun typecheck`
  (never `tsc` directly, never from the repo root via turbo unless you mean it —
  turbo telemetry is disabled in this repo: keep `TURBO_TELEMETRY_DISABLED=1`).
- Tests from package dirs: `cd packages/opencode && bun test`
  (the root has a guard: `do-not-run-tests-from-root`).

### Grist-specific commands (for testing your change)

```bash
bun run --cwd packages/opencode src/index.ts gateway   # start gateway locally
grist auth login --provider grist --gateway http://127.0.0.1:8787
grist usage                                            # spend by rung
```

Gate logs: `[grist:gate] cheapest|medium|frontier|premium`. Disable with
`GRIST_GATE=off`. Control plane: `GRIST_CTRL=off`.

## Pull requests

- **Issue first:** all PRs reference an existing issue (`Fixes #123`).
  For small fixes a brief issue is fine.
- Keep PRs small and focused; explain the issue and why your change fixes it.
- UI changes: include before/after screenshots or video.
- Logic changes: explain how you verified it — what you tested, how a
  reviewer can reproduce it.
- PR titles follow conventional commits: `fix(tui): ...`, `feat(gate): ...`.
- If you changed the public Protocol or Server `HttpApi`, run
  `bun run generate` from `packages/client` (never edit `src/generated`
  directly).

## Adding providers

New providers shouldn't need many code changes. The gateway resolves
(user, rung) → (provider, key, model); OpenRouter, Vercel AI Gateway, and
generic OpenAI-compatible endpoints are the supported shapes. Open an issue
before adding a new provider family.

## Security reports

See [SECURITY.md](SECURITY.md). Do not open public issues for vulnerabilities.
