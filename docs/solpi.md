# Grist SoL-Pi mechanisms (Phase 2 ports)

Harness-layer token cuts from *SoL-Pi* (arXiv:2609.20519). Both sit behind env
kill switches and multiply savings on every model rung.

## ObservationPack

Tool outputs **>10KB**: deliver full text twice for the same
`(tool, content)` identity, then replace with a **handle + ~1KB excerpt**. Full
text is written under the truncation dir; Grep/Read that path for more.

- Hooked in `Tool.wrap` (all tools) and shell raw output (`packages/opencode/src/tool/shell.ts`).
- Disable: `GRIST_OBS_PACK=off`
- Log marker: `[grist:observation-pack]`

## Action Fusion

`edit_verify` tool: exact-string edit + follow-up shell verify in **one** call.

- Implementation: `packages/opencode/src/tool/edit-verify.ts`
- Prefer over separate `edit` → `bash` when the change has a clear check.
- Doctrine nudges agents to use it (surgical-engineer §5).
- Hidden when the model uses `apply_patch` instead of `edit`/`write`.

## Tests

```bash
bun run --cwd packages/opencode test src/grist/observation-pack.test.ts
bun run --cwd packages/opencode test src/grist/action-fusion.test.ts
```
