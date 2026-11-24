import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Option } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { collectStream } from "@opencode/util/process"
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { makeFiles } from "../src/environment/index"
import { Sandbox } from "../src/environment/sandbox"
import { buildPolicy } from "../src/environment/sandbox-policy"

const spawner = await Effect.runPromise(
  Effect.gen(function* () {
    return yield* ChildProcessSpawner.ChildProcessSpawner
  }).pipe(Effect.provide(LayerNode.compile(CrossSpawnSpawner.node))),
)

const CANARY = "CANARY-7f3a9"

/** Fake home with a credential canary, a worktree, and a neutral system dir. */
const fixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "opencode-sandbox-driver-"))
  const home = path.join(root, "home")
  const worktree = path.join(root, "worktree")
  const system = path.join(root, "system")
  mkdirSync(path.join(home, ".ssh"), { recursive: true })
  mkdirSync(worktree, { recursive: true })
  mkdirSync(system, { recursive: true })
  writeFileSync(path.join(home, ".ssh", "canary.txt"), CANARY)
  writeFileSync(path.join(worktree, "hello.txt"), "hello")
  writeFileSync(path.join(system, "sys.txt"), "system")
  const policy = buildPolicy({ directory: worktree, home, sourceEnv: {} })
  return { root, home, worktree, system, policy, canary: path.join(home, ".ssh", "canary.txt") }
}

const run = (driver: ReturnType<typeof Sandbox.makeSandboxDriver>, command: ChildProcess.Command) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* driver.spawner.spawn(command)
        const [out, code] = yield* Effect.all(
          [
            collectStream(handle.stdout, 64 * 1024).pipe(Effect.map((result) => new TextDecoder().decode(result.buffer))),
            handle.exitCode,
          ],
          { concurrency: "unbounded" },
        )
        return { out, code: Number(code) }
      }),
    ),
  )

const failureTag = (exit: Exit.Exit<unknown, unknown>): string | undefined => {
  if (Exit.isSuccess(exit)) return undefined
  const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
  if (!error) return undefined
  return (error as { _tag: string })._tag
}

describe("SandboxDriver fail-closed spawner", () => {
  test("an unavailable backend fails every spawn with the reason; nothing runs unjailed", async () => {
    const { policy } = fixture()
    const driver = Sandbox.makeSandboxDriver({
      spawner,
      policy,
      capability: { backend: "none", available: false, reason: "no sandbox backend exists for this platform yet" },
    })
    const exit = await Effect.runPromise(
      Effect.exit(Effect.scoped(driver.spawner.spawn(ChildProcess.make("echo", ["should-never-run"])))),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause)) as Error | undefined
      expect(String(error?.message ?? error)).toContain("no sandbox backend exists for this platform yet")
    }
  })
})

describe("SandboxDriver live jail (this machine's real capability)", () => {
  test("the canary is unreachable and the environment is scrubbed — or the spawn refuses outright", async () => {
    const { home, worktree, policy, canary } = fixture()
    const capability = await Effect.runPromise(Sandbox.capability(process.env))
    const driver = Sandbox.makeSandboxDriver({ spawner, policy, capability })
    if (!capability.available) {
      const exit = await Effect.runPromise(
        Effect.exit(Effect.scoped(driver.spawner.spawn(ChildProcess.make("true", [])))),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      return
    }
    const read = await run(driver, ChildProcess.make("cat", [canary]))
    expect(read.out).not.toContain(CANARY)
    expect(read.code).not.toBe(0)

    process.env.SANDBOX_TEST_SECRET = "hunter2"
    try {
      const env = await run(driver, ChildProcess.make("env", [], { extendEnv: true, cwd: worktree }))
      expect(env.code).toBe(0)
      expect(env.out).toContain(`HOME=${policy.scratchHome}`)
      expect(env.out).toContain(`HTTP_PROXY=http://127.0.0.1:${policy.proxyPort}`)
      expect(env.out).not.toContain("hunter2")
      expect(env.out).not.toContain("SANDBOX_TEST_SECRET")
      expect(env.out).not.toContain(home)
    } finally {
      delete process.env.SANDBOX_TEST_SECRET
    }

    const cycle = await run(driver, ChildProcess.make("sh", ["-c", "echo built > note.txt && cat note.txt"], { cwd: worktree }))
    expect(cycle.code).toBe(0)
    expect(cycle.out).toContain("built")
    expect(readFileSync(path.join(worktree, "note.txt"), "utf8")).toContain("built")
  })
})

describe("SandboxDriver files policy", () => {
  test("reads mirror the jail view; writes are confined to the worktree", async () => {
    const { home, worktree, system, policy, canary } = fixture()
    const driver = Sandbox.makeSandboxDriver({
      spawner,
      policy,
      capability: { backend: "none", available: false, reason: "files policy is spawner-independent" },
    })
    const files = makeFiles(driver)
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

    const inside = await Effect.runPromise(files.read(path.join(worktree, "hello.txt")))
    expect(decode(inside.bytes)).toBe("hello")

    // System paths stay readable (binaries, toolchain); only the policy's
    // masked locations disappear.
    const sys = await Effect.runPromise(files.read(path.join(system, "sys.txt")))
    expect(decode(sys.bytes)).toBe("system")

    const credential = await Effect.runPromise(Effect.exit(files.read(canary)))
    expect(failureTag(credential)).toBe("Environment.NotFound")

    // A symlink inside the worktree cannot smuggle the canary in.
    symlinkSync(canary, path.join(worktree, "escape.txt"))
    const escaped = await Effect.runPromise(Effect.exit(files.read(path.join(worktree, "escape.txt"))))
    expect(failureTag(escaped)).toBe("Environment.NotFound")

    const written = await Effect.runPromise(
      Effect.exit(files.write(path.join(worktree, "new.txt"), new TextEncoder().encode("new"))),
    )
    expect(Exit.isSuccess(written)).toBe(true)

    const outside = await Effect.runPromise(
      Effect.exit(files.write(path.join(system, "nope.txt"), new TextEncoder().encode("nope"))),
    )
    expect(failureTag(outside)).toBe("Environment.Failed")

    const maskedWrite = await Effect.runPromise(
      Effect.exit(files.write(path.join(home, "evil.txt"), new TextEncoder().encode("evil"))),
    )
    expect(failureTag(maskedWrite)).toBe("Environment.Failed")
  })
})
