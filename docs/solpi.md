# Grist SoL-Pi mechanisms (Phase 2 ports)

Harness-layer token cuts from *SoL-Pi* (arXiv:2609.20519). Both sit behind env
kill switches and multiply savings on every model rung.

## Mechanism Choice (`GRIST_MECH`)

Per-task Choice (pre-POC §5) picks a profile; logged as `[grist:mech]`:

| Profile | Env | ObservationPack | Action Fusion |
| --- | --- | --- | --- |
| **auto** (default) | `GRIST_MECH=auto` | heuristic | on |
| **efficiency** | `GRIST_MECH=efficiency` | on | on |
| **performance** | `GRIST_MECH=performance` | off (full fidelity) | on |
| **off** | `GRIST_MECH=off` | off | off |

Auto heuristic: exploration/diagnosis → performance; build/test/edit → efficiency.
Choice is remembered per session so `Tool.wrap` / shell honor ObservationPack
and the tool registry honors Action Fusion (`edit_verify` is omitted when off).
Session delete clears both per-session maps.

## ObservationPack

Tool outputs **>10KB**: deliver full text twice for the same
`(tool, content)` identity, then replace with a **handle + ~1KB excerpt**
(first ~256 bytes plus the tail, so build/test errors survive packing). Full
text is written under the truncation dir; Grep/Read that path for more.

- Hooked in `Tool.wrap` (all tools) and shell raw output (`packages/opencode/src/tool/shell.ts`).
- Disable globally: `GRIST_OBS_PACK=off`
- Per-task: turned off under `performance` / `off` profiles
- Optional cost gate: `GRIST_MECH_COST_GATE=on` (+ `GRIST_OBS_PACK_MIN_BYTES`)
- Log marker: `[grist:observation-pack]`

## Action Fusion

`edit_verify` tool: exact-string edit + follow-up shell verify in **one** call.

- Implementation: `packages/opencode/src/tool/edit-verify.ts`
- Prefer over separate `edit` → `bash` when the change has a clear check.
- Hidden when the model uses `apply_patch` instead of `edit`/`write`, and when
  the session mechanism set has fusion off (`GRIST_MECH=off`).
- Doctrine nudges agents to use it only when fusion is on (surgical-engineer §5).

## Tests

```bash
bun run --cwd packages/opencode test src/grist/observation-pack.test.ts
bun run --cwd packages/opencode test src/grist/action-fusion.test.ts
bun run --cwd packages/opencode test src/grist/mechanisms.test.ts
bun run --cwd packages/opencode test src/grist/doctrine.test.ts
```
