# Grist Desktop

Mac / Windows / Linux GUI for Grist, forked from OpenCode Desktop (Electron + `packages/app`).

## Development

```bash
bun install
bun run --cwd packages/desktop dev
```

## Build (Mac)

```bash
bun run --cwd packages/desktop build
bun run --cwd packages/desktop package:mac
```

The app appears as **Grist** / **Grist Dev**. Deep links use `grist://`. App ids are `ai.grist.desktop*`.
