import { spawn } from "node:child_process"
import type { ListenerCycleResult, ListenerExecRun, ListenerRunnerStatus } from "@grist-ai/logic"
import { selfCommand } from "../../../util/process"

/**
 * Pure rendering of `grist listener status` — the per-repo, per-machine
 * runner opt-in (D14). Never includes any credential.
 */
export function formatListenerStatus(status: ListenerRunnerStatus, cwd: string): string {
  if (!status.enabled) {
    return [
      `Listener runner: off for ${cwd} on this machine (${status.machine})`,
      "  Opt in with: grist listener enable",
      "  Only requests for this repo run here; runs execute as each listener's creator.",
    ].join("\n")
  }
  const lines = [
    `Listener runner: on for ${cwd} on this machine (${status.machine})`,
    "  Claim work with: grist listener run-once   or stay polling: grist listener watch",
  ]
  if (status.lastRunAt) lines.push(`  Last run: ${new Date(status.lastRunAt).toISOString()}`)
  if (status.lastError) lines.push(`  Last error: ${status.lastError}`)
  lines.push(`  State: ${status.path}`)
  return lines.join("\n")
}

export function listenerStatusJson(status: ListenerRunnerStatus, cwd: string) {
  return {
    enabled: status.enabled,
    machine: status.machine,
    directory: cwd,
    ...(status.lastRunAt ? { last_run_at: new Date(status.lastRunAt).toISOString() } : {}),
    ...(status.lastError ? { last_error: status.lastError } : {}),
    state_path: status.path,
  }
}

/** One line per cycle outcome, for run-once and watch output. */
export function formatCycleResult(result: ListenerCycleResult): string {
  switch (result.status) {
    case "disabled":
      return "Listener runner is off for this repo on this machine — run: grist listener enable"
    case "no_config":
      return "Not signed in to Grist — run: grist auth login --provider grist"
    case "no_repo_identity":
      return "This repo has no GitHub origin remote, so listener requests cannot be matched to it."
    case "idle":
      return "No queued listener requests for this repo."
    case "contended":
      return `Request ${result.requestId} was claimed by another runner first.`
    case "refused":
      return `Request ${result.requestId} refused at claim: ${result.reason} (the creator was notified).`
    case "expired":
      return `Request ${result.requestId} expired before it could be claimed.`
    case "completed":
      return (
        `Request ${result.requestId} ${result.outcome}: spend $${result.spendUsd.toFixed(4)}` +
        (result.sessionId ? ` · session ${result.sessionId}` : "") +
        (result.overRunCap ? " · over the listener's per-run cap (recorded on the audit trail)" : "")
      )
    case "error":
      return `Runner error: ${result.message}`
  }
}

/**
 * The real executor: a claimed request runs as a child `grist run` in
 * this repo, inheriting this process's environment — so the run
 * presents the same gateway credential the operator signed in with,
 * and the gateway meters it exactly like an interactive run (team key
 * sharing included). The request's environment/conversation/agent
 * targets map to the run's own flags. Success = clean exit with no
 * error event in the JSON stream.
 */
export const execListenerRun: ListenerExecRun = (input) =>
  new Promise((resolve) => {
    const args = [
      "run",
      "--format",
      "json",
      ...(input.environment ? ["--env", input.environment] : []),
      ...(input.conversation ? ["--conversation", input.conversation] : []),
      ...(input.agent ? ["--agent", input.agent] : []),
      input.prompt,
    ]
    const command = selfCommand()
    const child = spawn(command[0] as string, [...command.slice(1), ...args], {
      cwd: input.directory,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096)
    })
    child.on("error", (error) => resolve({ ok: false, error: error.message }))
    child.on("close", (code) => {
      let sessionId: string | undefined
      let streamError: string | undefined
      for (const line of stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue
        try {
          const event = JSON.parse(line) as {
            type?: string
            sessionID?: string
            error?: { data?: { message?: string }; name?: string }
          }
          if (typeof event.sessionID === "string") sessionId = event.sessionID
          if (event.type === "error") {
            streamError = event.error?.data?.message ?? event.error?.name ?? "the run reported an error"
          }
        } catch {
          // Non-JSON lines are not run events; the exit code decides.
        }
      }
      if (code === 0 && !streamError) {
        resolve({ ...(sessionId ? { sessionId } : {}), ok: true })
        return
      }
      const tail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 500)
      resolve({
        ...(sessionId ? { sessionId } : {}),
        ok: false,
        error: streamError ?? tail ?? `grist run exited with code ${code ?? "unknown"}`,
      })
    })
  })
