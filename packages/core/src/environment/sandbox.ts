import fs from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Effect, PlatformError } from "effect"
import { ChildProcess } from "effect/process"
import { make } from "effect/process/ChildProcessSpawner"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { Environment } from "@opencode/schema/environment"
import type { Driver } from "./driver.js"
import { execDefaults } from "./exec-defaults.js"
import { Failed, NotFound, type FilesImpl } from "./files.js"
import { makeLocalDriver } from "./local.js"
import {
  buildPolicy,
  jailedEnv,
  policySummary,
  type SandboxCapability,
  type SandboxPolicy,
} from "./sandbox-policy.js"
import { detectTooling, jailArgs, missingTool, probeJail, wrapperScript } from "./sandbox-linux.js"
import {
  detectSandboxExec,
  profilePath,
  profileText,
  SANDBOX_EXEC_PATH,
  wrapperScript as macosWrapperScript,
} from "./sandbox-macos.js"
import { ensureProxy } from "./sandbox-proxy.js"

/**
 * The sandbox driver (spec §4.4): a second implementation of core's
 * Environment Driver seam that wraps the local driver. File operations
 * pass through to the local driver's implementation with the policy view
 * enforced (the same view the jail presents: worktree writable, home
 * masked, credential locations nonexistent, system paths read-only).
 * Process spawns are delegated to the local spawner but launched inside
 * the OS jail — bubblewrap namespaces on Linux, a generated sandbox-exec
 * profile on macOS.
 *
 * Fail-closed is structural: when the backend is unavailable on this
 * machine the spawner fails every spawn with the reason, and environment
 * creation is refused upstream. Nothing here ever falls back to running
 * a sandbox session's processes unjailed.
 */

export type { SandboxCapability, SandboxPolicy }

const probeCache = new Map<string, Promise<SandboxCapability>>()

/** Whether the sandbox backend can run on this machine, probed once per toolset and cached. */
export const capability = (sourceEnv: NodeJS.ProcessEnv): Effect.Effect<SandboxCapability> => {
  const tooling = process.platform === "linux" ? detectTooling(sourceEnv) : undefined
  const key = [process.platform, tooling?.bwrap ?? "", tooling?.socat ?? ""].join("|")
  const cached = probeCache.get(key)
  if (cached) return Effect.promise(() => cached)
  const promise = probe(sourceEnv)
  probeCache.set(key, promise)
  return Effect.promise(() => promise)
}

const probe = async (sourceEnv: NodeJS.ProcessEnv): Promise<SandboxCapability> => {
  if (process.platform === "win32") {
    return {
      backend: "none",
      available: false,
      reason: "The Windows sandbox backend has not landed yet (spec §4.4 allows it to lag); sandbox environments are unavailable on Windows",
    }
  }
  if (process.platform === "darwin") {
    if (detectSandboxExec()) return { backend: "sandbox-exec", available: true }
    return {
      backend: "sandbox-exec",
      available: false,
      reason: `sandbox-exec was not found at ${SANDBOX_EXEC_PATH}; on this macOS version the sandbox kind is unavailable and never degrades to unsandboxed execution`,
    }
  }
  if (process.platform !== "linux") {
    return { backend: "none", available: false, reason: `No sandbox backend exists for ${process.platform} yet` }
  }
  const tooling = detectTooling(sourceEnv)
  const missing = missingTool(tooling)
  if (missing) return { backend: "bwrap", available: false, reason: missing }
  const launched = await Effect.runPromise(probeJail(tooling.bwrap!))
  if (!launched) {
    return {
      backend: "bwrap",
      available: false,
      reason:
        "bubblewrap is installed but a test jail failed to launch — user namespaces appear to be blocked on this machine",
    }
  }
  return { backend: "bwrap", available: true }
}

export const policyFor = (input: {
  readonly directory: string
  readonly home?: string
  readonly sourceEnv?: NodeJS.ProcessEnv
}): SandboxPolicy =>
  buildPolicy({ directory: input.directory, home: input.home ?? homedir(), sourceEnv: input.sourceEnv ?? process.env })

export const summaryFor = (input: {
  readonly directory: string
  readonly home?: string
  readonly sourceEnv?: NodeJS.ProcessEnv
}): Effect.Effect<Environment.PolicySummary> =>
  capability(input.sourceEnv ?? process.env).pipe(
    Effect.map((probed) =>
      policySummary({ platform: process.platform, capability: probed, policy: policyFor(input) }),
    ),
  )

/** Create the scratch tree and record the enforced policy inside it (`<worktree>/.grist/sandbox/policy.json`). */
export const recordPolicy = (policy: SandboxPolicy, summary: Environment.PolicySummary): Effect.Effect<void> =>
  Effect.promise(async () => {
    await fs.mkdir(policy.scratchHome, { recursive: true })
    await fs.mkdir(policy.scratchTmp, { recursive: true })
    await fs.writeFile(
      path.join(policy.scratch, "policy.json"),
      `${JSON.stringify(
        {
          backend: summary.backend,
          surfaces: {
            filesystem: summary.filesystem,
            network: summary.network,
            environment: summary.environment,
            limits: summary.limits,
          },
          egressAllowlist: summary.egressAllowlist,
          limits: policy.limits,
        },
        null,
        2,
      )}\n`,
    )
  })

export interface SandboxDriverInput {
  readonly spawner: ChildProcessSpawner["Service"]
  readonly policy: SandboxPolicy
  readonly capability: SandboxCapability
}

export const makeSandboxDriver = (input: SandboxDriverInput): Driver => {
  const local = makeLocalDriver(input.spawner)
  // The local driver's full file implementation (its overrides over the
  // exec defaults, exactly as `makeFiles` composes it), policy-wrapped.
  const inner: FilesImpl = { ...execDefaults(local.spawner), ...local.overrides }
  const overrides = policyFiles(inner, input.policy)
  if (!input.capability.available) return { spawner: unavailableSpawner(input.capability), overrides }
  return { spawner: jailedSpawner(input), overrides }
}

const spawnError = (description: string, cause?: unknown) =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: "Environment",
    method: "spawn",
    description,
    cause,
  })

const unavailableSpawner = (probed: SandboxCapability): ChildProcessSpawner["Service"] =>
  make(() =>
    Effect.fail(
      spawnError(`Sandbox unavailable on this machine: ${probed.reason ?? "the sandbox backend cannot run here"}`),
    ),
  )

const jailedSpawner = (input: SandboxDriverInput): ChildProcessSpawner["Service"] => {
  const policy = input.policy
  let ready: Promise<void> | undefined
  const ensureReady = () => {
    ready ??= (async () => {
      await fs.mkdir(policy.scratchHome, { recursive: true })
      await fs.mkdir(policy.scratchTmp, { recursive: true })
      if (input.capability.backend === "sandbox-exec")
        await fs.writeFile(profilePath(policy), profileText(policy))
    })()
    return ready
  }
  return make((command) =>
    Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: ensureReady,
        catch: (cause) => spawnError("Failed to prepare the sandbox scratch directory", cause),
      })
      if (input.capability.backend === "bwrap") {
        yield* ensureProxy({
          socketPath: policy.proxySocket,
          allowlist: policy.egressAllowlist,
          sourceEnv: process.env,
        }).pipe(
          Effect.mapError((cause) => spawnError("Failed to start the sandbox egress proxy", cause)),
        )
      }
      return yield* input.spawner.spawn(transform(command, input))
    }),
  )
}

const transform = (command: ChildProcess.Command, input: SandboxDriverInput): ChildProcess.Command => {
  if (ChildProcess.isPipedCommand(command)) {
    return ChildProcess.pipeTo(transform(command.left, input), transform(command.right, input), command.options)
  }
  const policy = input.policy
  const env = jailedEnv({
    ambient: process.env,
    explicit: command.options.env,
    extendEnv: command.options.extendEnv,
    policy,
  })
  const cwd = command.options.cwd ?? policy.worktree
  const payload = payloadArgv(command)
  const argv =
    input.capability.backend === "bwrap"
      ? [
          ...jailArgs({ tooling: detectTooling(process.env), policy, env, cwd }),
          "/bin/sh",
          "-c",
          wrapperScript(policy),
          "grist-sandbox",
          ...payload,
        ]
      : [
          SANDBOX_EXEC_PATH,
          "-f",
          profilePath(policy),
          "/bin/sh",
          "-c",
          macosWrapperScript(policy),
          "grist-sandbox",
          ...payload,
        ]
  const [head, ...tail] = argv
  return ChildProcess.make(head!, tail, {
    cwd,
    env,
    extendEnv: false,
    stdin: command.options.stdin,
    stdout: command.options.stdout,
    stderr: command.options.stderr,
    detached: command.options.detached,
    killSignal: command.options.killSignal,
    forceKillAfter: command.options.forceKillAfter,
    additionalFds: command.options.additionalFds,
  })
}

/** The payload's own argv. A `shell` command is reconstructed as a shell invocation carrying the joined command line. */
const payloadArgv = (command: ChildProcess.StandardCommand): ReadonlyArray<string> => {
  if (command.options.shell === undefined) return [command.command, ...command.args]
  const shell = typeof command.options.shell === "string" ? command.options.shell : "/bin/sh"
  return [shell, "-c", [command.command, ...command.args].join(" ")]
}

const isWithin = (target: string, root: string) => target === root || target.startsWith(root + path.sep)

/** Whether the path is invisible in the jail's view: a credential location, or the home tree outside the worktree. */
const masked = (policy: SandboxPolicy, target: string): boolean => {
  if (policy.credentialDirs.some((dir) => isWithin(target, dir))) return true
  if (policy.credentialFiles.some((file) => target === file)) return true
  return isWithin(target, policy.home) && !isWithin(target, policy.worktree)
}

/** Reads mirror the jail: a masked path does not exist in its view; anything else readable on the host is readable. */
const guardRead = (policy: SandboxPolicy, target: string): NotFound | undefined =>
  masked(policy, target) ? new NotFound({ path: target }) : undefined

/** Writes are confined to the worktree; a masked target reports the confinement instead. */
const guardWrite = (policy: SandboxPolicy, target: string): Failed | undefined => {
  if (masked(policy, target)) {
    return new Failed({
      path: target,
      cause: new Error("Sandbox policy: this path is not visible inside the sandbox"),
    })
  }
  if (isWithin(target, policy.worktree)) return undefined
  return new Failed({
    path: target,
    cause: new Error(`Sandbox policy: writes are confined to the environment worktree (${policy.worktree})`),
  })
}

/**
 * The local driver's file operations with the policy view enforced before
 * delegation. Reads resolve symlinks before the check, so a symlink inside
 * the worktree cannot smuggle a read of a masked target; writes resolve
 * the parent directory for the same reason.
 */
const policyFiles = (inner: FilesImpl, policy: SandboxPolicy): FilesImpl => {
  const resolved = (value: string, follow: boolean) =>
    Effect.promise(async () => {
      const absolute = path.resolve(policy.worktree, value)
      if (!follow) return absolute
      try {
        return await fs.realpath(absolute)
      } catch {
        return absolute
      }
    })
  const resolvedParent = (value: string) =>
    Effect.promise(async () => {
      const absolute = path.resolve(policy.worktree, value)
      try {
        return path.join(await fs.realpath(path.dirname(absolute)), path.basename(absolute))
      } catch {
        return absolute
      }
    })
  const checkRead = (target: string) => {
    const denial = guardRead(policy, target)
    return denial ? Effect.fail(denial) : Effect.void
  }
  const checkWrite = (target: string) => {
    const denial = guardWrite(policy, target)
    return denial ? Effect.fail(denial) : Effect.void
  }
  return {
    read: (value, range) =>
      resolved(value, true).pipe(
        Effect.flatMap((target) => checkRead(target)),
        Effect.flatMap(() => inner.read(value, range)),
      ),
    stat: (value) =>
      resolved(value, false).pipe(
        Effect.flatMap((target) => checkRead(target)),
        Effect.flatMap(() => inner.stat(value)),
      ),
    list: (value) =>
      resolved(value, true).pipe(
        Effect.flatMap((target) => checkRead(target)),
        Effect.flatMap(() => inner.list(value)),
      ),
    write: (value, bytes) =>
      resolvedParent(value).pipe(
        Effect.flatMap((target) => checkWrite(target)),
        Effect.flatMap(() => inner.write(value, bytes)),
      ),
    remove: (value) =>
      resolvedParent(value).pipe(
        Effect.flatMap((target) => checkWrite(target)),
        Effect.flatMap(() => inner.remove(value)),
      ),
    move: (from, to) =>
      resolvedParent(from).pipe(
        Effect.flatMap((target) => checkWrite(target)),
        Effect.flatMap(() => resolvedParent(to)),
        Effect.flatMap((target) => checkWrite(target)),
        Effect.flatMap(() => inner.move(from, to)),
      ),
    mkdir: (value) =>
      resolvedParent(value).pipe(
        Effect.flatMap((target) => checkWrite(target)),
        Effect.flatMap(() => inner.mkdir(value)),
      ),
  }
}

export * as Sandbox from "./sandbox.js"
