# @grist-ai/grist-skills

The Grist agent skill: teaches a personal AI agent (Muse, OpenClaw, Hermes,
OpenCode, …) how to delegate multi-step coding tasks to the Grist CLI —
headless runs, auth, BYOK billing, and the report-back contract.

## Install

With the [skills CLI](https://github.com/vercel-labs/skills), from the
published npm tarball:

```bash
npx skills add https://registry.npmjs.org/@grist-ai/grist-skills/-/grist-skills-<version>.tgz
```

(replace `<version>` with the released version).

## Contents

- `SKILL.md` — the skill. The `name`/`description` frontmatter is what the
  skills CLI indexes.

## Release

Bump `version` in `package.json` when `SKILL.md` changes. The
`publish-grist` workflow stages `dist/grist-skills/` from this directory and
publishes it to npm (skipped automatically when the version is already
published).
