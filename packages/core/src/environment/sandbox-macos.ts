import fs from "node:fs"
import path from "node:path"
import type { SandboxPolicy } from "./sandbox-policy.js"

/**
 * macOS backend: a generated `sandbox-exec` profile per environment
 * (spec §4.4). Apple deprecated sandbox-exec; it still ships and works,
 * and the spec's fallback is wired into detection: if the binary is gone,
 * the macOS sandbox is unavailable — it never silently degrades to
 * unsandboxed execution.
 *
 * The profile is generated from the same policy object as the Linux jail:
 * writes confined to the worktree (plus the system temp dirs a build
 * needs), reads denied across the user's home with the worktree carved
 * back, credential locations denied outright, and network constrained to
 * the port classes sandbox-exec can express (the per-host allowlist is
 * the documented degraded surface — see the policy summary).
 */

export const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec"

export const detectSandboxExec = (): string | undefined =>
  fs.existsSync(SANDBOX_EXEC_PATH) ? SANDBOX_EXEC_PATH : undefined

const literal = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`

/** The in-jail launcher: rlimits, then the payload as a child (no forwarder — macOS network rules live in the profile). */
export const wrapperScript = (policy: SandboxPolicy): string => {
  const lines: Array<string> = []
  if (policy.limits.cpuSeconds !== undefined) lines.push(`ulimit -t ${policy.limits.cpuSeconds} 2>/dev/null`)
  if (policy.limits.maxProcesses !== undefined) lines.push(`ulimit -u ${policy.limits.maxProcesses} 2>/dev/null`)
  if (policy.limits.memoryBytes !== undefined)
    lines.push(`ulimit -v ${Math.floor(policy.limits.memoryBytes / 1024)} 2>/dev/null`)
  lines.push('"$@"', "exit $?")
  return lines.join("\n")
}

export const profileText = (policy: SandboxPolicy): string => {
  const lines: Array<string> = [
    "(version 1)",
    "(allow default)",
    "",
    ";; Writes are confined to the worktree (scratch lives inside it) and temp space.",
    "(deny file-write*)",
    `(allow file-write* (subpath ${literal(policy.worktree)}))`,
    `(allow file-write* (subpath ${literal("/tmp")}))`,
    `(allow file-write* (subpath ${literal("/private/tmp")}))`,
    `(allow file-write* (subpath ${literal("/dev")}))`,
    "",
    ";; The user's home is unreadable, with the worktree carved back. Credential",
    ";; locations are denied explicitly as well, so they stay denied even where a",
    ";; broader rule would reach them.",
    `(deny file-read* (subpath ${literal(policy.home)}))`,
    `(allow file-read* (subpath ${literal(policy.worktree)}))`,
  ]
  for (const dir of policy.credentialDirs) lines.push(`(deny file-read* file-write* (subpath ${literal(dir)}))`)
  for (const file of policy.credentialFiles) lines.push(`(deny file-read* file-write* (literal ${literal(file)}))`)
  lines.push(
    "",
    ";; sandbox-exec cannot express a per-host allowlist: outbound is limited to",
    ";; the web port classes and everything else is denied (degraded, disclosed).",
    "(deny network*)",
    `(allow network-outbound (remote tcp "*:80"))`,
    `(allow network-outbound (remote tcp "*:443"))`,
    "",
    ";; Process ceilings are rlimits applied by the launcher (no cgroup equivalent).",
  )
  return lines.join("\n") + "\n"
}

/** Where the generated profile is recorded inside the environment's scratch dir. */
export const profilePath = (policy: SandboxPolicy): string => path.join(policy.scratch, "sandbox.sb")

export * as SandboxMacos from "./sandbox-macos.js"
