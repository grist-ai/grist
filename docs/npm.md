# Publishing Grist to npm

Users install the CLI as **`grist-ai`** (the bare name `grist` is taken on npm):

```bash
npm install -g grist-ai
grist
```

Or without a global install:

```bash
npx grist-ai
```

Platform binaries ship as optional deps (`grist-darwin-arm64`, `grist-linux-x64`, …).
Postinstall copies the matching binary into `bin/grist.exe`.

## Local / maintainer publish

```bash
# 1. Build (current machine only = faster)
OPENCODE_VERSION=0.1.0 OPENCODE_CHANNEL=latest \
  bun run --cwd packages/opencode build:single

# 2. Or full multi-platform matrix (CI)
OPENCODE_VERSION=0.1.0 OPENCODE_CHANNEL=latest \
  bun run --cwd packages/opencode build

# 3. Publish wrapper + platform packages
npm login   # or export NODE_AUTH_TOKEN=...
OPENCODE_VERSION=0.1.0 OPENCODE_CHANNEL=latest \
  bun run --cwd packages/opencode publish:npm
```

After publish:

```bash
npm install -g grist-ai@0.1.0
grist --version
```

## GitHub Actions

Workflow: [`.github/workflows/publish-grist.yml`](../.github/workflows/publish-grist.yml)

1. Add repo secret **`NPM_TOKEN`** (Automation token with publish rights).
2. Actions → **publish-grist** → Run workflow.
3. Set `version` (e.g. `0.1.0`) or leave blank to auto-bump from the registry.
4. First CI smoke: enable **single** (current platform only). Full release: leave single off
   (builds all OS/arch targets — slower, needs a larger runner).

## Env

| Var | Purpose |
| --- | --- |
| `OPENCODE_VERSION` | Exact semver to stamp binaries / npm |
| `OPENCODE_CHANNEL` | npm dist-tag (`latest`, `beta`, …) |
| `OPENCODE_RELEASE` | When set, also upload zip/tar artifacts if `gh` is configured |
| `NODE_AUTH_TOKEN` | npm auth for `npm publish` |

Product constants live in `packages/opencode/script/product.ts`
(`PRODUCT_NPM=grist-ai`, `PRODUCT_BIN=grist`).
