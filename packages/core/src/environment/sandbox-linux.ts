import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import type { SandboxPolicy } from "./sandbox-policy.js"

/**
 * Linux backend: bubblewrap namespaces (spec §4.4, the reference
 * implementation). Detection is capability-based and fail-closed: the
 * sandbox is available only when `bwrap` and `socat` are on PATH and a
 * minimal jail actually launches — a machine where namespace creation is
 * blocked reports unavailable, never a silent unsandboxed fallback.
 */

export interface LinuxTooling {
  readonly bwrap?: string
  readonly socat?: string
}

export const findExecutable = (name: string, sourceEnv: NodeJS.ProcessEnv): string | undefined => {
  for (const dir of (sourceEnv.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  return undefined
}

export const detectTooling = (sourceEnv: NodeJS.ProcessEnv): LinuxTooling => ({
  bwrap: findExecutable("bwrap", sourceEnv),
  socat: findExecutable("socat", sourceEnv),
})

export const missingTool = (tooling: LinuxTooling): string | undefined => {
  if (!tooling.bwrap) return "bubblewrap (bwrap) was not found on PATH"
  if (!tooling.socat) return "socat was not found on PATH (the in-jail egress forwarder needs it)"
  return undefined
}

/** Launch a minimal real jail once. Some kernels/VMs accept the binaries but block namespace creation; only a launch proves the backend. */
export const probeJail = (bwrap: string): Effect.Effect<boolean> =>
  Effect.callback<boolean>((resume) => {
    const child = execFile(
      bwrap,
      ["--unshare-user", "--unshare-net", "--ro-bind", "/", "/", "/bin/true"],
      { timeout: 10_000 },
      (error) => resume(Effect.succeed(!error)),
    )
    return Effect.sync(() => child.kill())
  })

/**
 * The in-jail launcher script: start the egress forwarder (loopback TCP to
 * the driver's filtering proxy over its bind-visible unix socket), apply
 * the rlimit ceilings, then run the payload as a child so the forwarder is
 * torn down with it. Numbers interpolated here come only from the policy's
 * validated integers.
 */
export const wrapperScript = (policy: SandboxPolicy): string => {
  const lines = [
    `socat TCP-LISTEN:${policy.proxyPort},bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:${policy.proxySocket} >/dev/null 2>&1 &`,
    "FWD=$!",
    "trap 'kill \"$FWD\" 2>/dev/null' EXIT",
  ]
  if (policy.limits.cpuSeconds !== undefined) lines.push(`ulimit -t ${policy.limits.cpuSeconds} 2>/dev/null`)
  if (policy.limits.maxProcesses !== undefined) lines.push(`ulimit -u ${policy.limits.maxProcesses} 2>/dev/null`)
  if (policy.limits.memoryBytes !== undefined)
    lines.push(`ulimit -v ${Math.floor(policy.limits.memoryBytes / 1024)} 2>/dev/null`)
  lines.push('"$@"', "exit $?")
  return lines.join("\n")
}

/**
 * The bubblewrap argument vector up to and including `--`: namespaces
 * first, then the mount view (host read-only, home masked, worktree bound
 * back writable, credential locations masked even where a bind restored
 * them), then the constructed environment and working directory.
 */
export const jailArgs = (input: {
  readonly tooling: LinuxTooling
  readonly policy: SandboxPolicy
  readonly env: Record<string, string>
  readonly cwd: string
}): ReadonlyArray<string> => {
  const policy = input.policy
  const args: Array<string> = [
    input.tooling.bwrap!,
    "--unshare-user",
    "--unshare-net",
    "--unshare-ipc",
    "--cap-drop",
    "ALL",
    "--die-with-parent",
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
  ]
  if (policy.home !== "/" && fs.existsSync(policy.home)) args.push("--tmpfs", policy.home)
  args.push("--bind", policy.worktree, policy.worktree)
  for (const dir of policy.credentialDirs) {
    if (fs.existsSync(dir)) args.push("--tmpfs", dir)
  }
  for (const file of policy.credentialFiles) {
    if (fs.existsSync(file)) args.push("--ro-bind", "/dev/null", file)
  }
  args.push("--clearenv")
  for (const [name, value] of Object.entries(input.env)) args.push("--setenv", name, value)
  args.push("--chdir", input.cwd, "--")
  return args
}

export * as SandboxLinux from "./sandbox-linux.js"
