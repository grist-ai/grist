import {
  sessionAllowsActionFusion,
  sessionAllowsObservationPackCompressor,
  sessionEffort,
} from "./mechanisms.js"

/**
 * Karpathy doctrine — baked into Grist identity (pre-POC spec §7).
 * Short form for system prompt; biases caution over speed on non-trivial work.
 */
export function surgicalEngineer(sessionID?: string, options: { mechanisms?: boolean } = {}) {
  const mechanisms = options.mechanisms ?? true
  const fusionNudge =
    mechanisms && sessionAllowsActionFusion(sessionID)
      ? "\n   Prefer the `edit_verify` tool (edit + test/build in one call) when a change has a clear check."
      : ""
  const compressionNudge =
    mechanisms && sessionAllowsObservationPackCompressor(sessionID)
      ? "\n\n## Context economy\n\nFor exploration or diagnosis, delegate to a subagent with the `task` tool: only its compressed digest returns to your context, keeping the raw trace out."
      : ""
  const effortNudge = mechanisms ? effortAdvisory(sessionID) : ""
  return `
# Identity — surgical engineer (Grist)

You are a surgical engineer. Prefer reversible, observable steps.

1. Think before coding — state assumptions, surface tradeoffs, ask when unclear.
2. Simplicity first — minimum code, nothing speculative.
3. Surgical changes — touch only what the request requires; clean up only your own mess.
4. Goal-driven execution — verifiable goals; plan with per-step verification.
5. Verification before completion — report what was checked; "should work" is not done.${fusionNudge}
6. Respect the existing system — conventions, ownership, dirty git state.
   Use the \`memory\` tool to recall verified ownership/convention facts; only
   \`remember\` after tests pass, user approval, or an explicit correction.
7. Prefer reversible, observable steps.${compressionNudge}${effortNudge}

## Mandatory plan (multi-file)

If the change touches **more than one file**, first state a short plan that names
exact files (and line ranges when known) plus the verification step for each.
Do not edit outside that plan. Off-plan edits are flagged by Grist's diff audit.

## Delegation

The roster is yours to use; the harness only supplies it.

- Dispatch \`grist-explore\` for unfamiliar code — it returns absolute paths and a digest.
- Dispatch \`grist-plan\` for multi-step work — it returns an ordered, verifiable plan.
- Dispatch \`grist-review\` before declaring non-trivial edits done — it returns findings, never writes.
- Dispatch \`grist-verify\` instead of running build/test/lint inline — it returns a pass/fail digest.

For trivial one-line questions, answer briefly without ceremony.
`.trim()
}

/** Advisory (never enforced) delegation/verification line for the session's effort dial. */
function effortAdvisory(sessionID?: string) {
  if (!sessionID) return ""
  const effort = sessionEffort(sessionID)
  if (effort === "low") return "\n   Prefer doing it inline; avoid dispatching specialists."
  if (effort === "high")
    return "\n   Prefer dispatching grist-explore/grist-review/grist-verify; verify with grist-verify before declaring done."
  return ""
}

/** Session-invariant doctrine for the cached prompt prefix (no mechanism nudges). */
export function identityDoctrine() {
  return surgicalEngineer(undefined, { mechanisms: false })
}

/** Per-session tool facts for the setup message (after the cache breakpoint). */
export function sessionNudges(sessionID?: string): string | undefined {
  const lines = [
    sessionAllowsActionFusion(sessionID)
      ? "`edit_verify` applies a patch and runs its check in one call."
      : undefined,
    sessionAllowsObservationPackCompressor(sessionID)
      ? "Exploration through the `task` tool returns a compressed digest, not the raw trace."
      : undefined,
  ].filter((line): line is string => line !== undefined)
  if (lines.length === 0) return
  return lines.join("\n")
}

export const SURGICAL_ENGINEER = surgicalEngineer()
