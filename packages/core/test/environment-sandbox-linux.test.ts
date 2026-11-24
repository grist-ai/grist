import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { buildPolicy } from "../src/environment/sandbox-policy"
import { detectTooling, findExecutable, jailArgs, missingTool, probeJail, wrapperScript } from "../src/environment/sandbox-linux"

const stubBin = (tools: Record<string, number>) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "opencode-stub-bin-"))
  for (const [name, code] of Object.entries(tools)) {
    const file = path.join(dir, name)
    writeFileSync(file, `#!/bin/sh\nexit ${code}\n`)
    chmodSync(file, 0o755)
  }
  return dir
}

/** A fake home + worktree on disk: the masks only engage for paths that exist. */
const fixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "opencode-sandbox-linux-"))
  const home = path.join(root, "home")
  const worktree = path.join(root, "worktree")
  mkdirSync(path.join(home, ".ssh"), { recursive: true })
  mkdirSync(worktree, { recursive: true })
  writeFileSync(path.join(home, ".netrc"), "machine example login x password y\n")
  const policy = buildPolicy({ directory: worktree, home, sourceEnv: {} })
  return { root, home, worktree, policy }
}

describe("SandboxLinux tooling detection (fail closed)", () => {
  test("finds executables on PATH and reports the missing piece by name", () => {
    const bin = stubBin({ bwrap: 0 })
    const env = { PATH: bin }
    const tooling = detectTooling(env)
    expect(tooling.bwrap).toBe(path.join(bin, "bwrap"))
    expect(tooling.socat).toBeUndefined()
    expect(missingTool(tooling)).toContain("socat")
    expect(findExecutable("bwrap", { PATH: "" })).toBeUndefined()
  })

  test("a bwrap that cannot launch a jail fails the probe", async () => {
    const bin = stubBin({ bwrap: 1 })
    const ok = await Effect.runPromise(probeJail(path.join(bin, "bwrap")))
    expect(ok).toBe(false)
  })

  test("a working bwrap passes the probe (skipped where bwrap is absent)", async () => {
    const real = findExecutable("bwrap", process.env)
    if (!real) return
    const ok = await Effect.runPromise(probeJail(real))
    expect(ok).toBe(true)
  })
})

describe("SandboxLinux jailArgs", () => {
  test("pins the jail choreography: masked home, bound worktree, constructed env", () => {
    const { home, worktree, policy } = fixture()
    const args = jailArgs({
      tooling: { bwrap: "/usr/bin/bwrap", socat: "/usr/bin/socat" },
      policy,
      env: { PATH: "/usr/bin", HOME: policy.scratchHome },
      cwd: worktree,
    })
    expect(args[0]).toBe("/usr/bin/bwrap")
    expect(args).toContain("--unshare-net")
    expect(args).toContain("--unshare-user")
    expect(args).toContain("--cap-drop")
    // The home is masked before the worktree is bound back in.
    const tmpfsHome = args.indexOf(home)
    const bindWorktree = args.indexOf(worktree)
    expect(tmpfsHome).toBeGreaterThan(-1)
    expect(bindWorktree).toBeGreaterThan(tmpfsHome)
    // Credential locations are masked after the binds.
    const sshMask = args.lastIndexOf(path.join(home, ".ssh"))
    expect(sshMask).toBeGreaterThan(bindWorktree)
    const netrc = args.indexOf(path.join(home, ".netrc"))
    expect(args[netrc - 2]).toBe("--ro-bind")
    expect(args[netrc - 1]).toBe("/dev/null")
    // Constructed environment only.
    expect(args).toContain("--clearenv")
    const setenv = args.indexOf("HOME")
    expect(args[setenv - 1]).toBe("--setenv")
    expect(args[setenv + 1]).toBe(policy.scratchHome)
    // Working directory and the command separator close the argv.
    expect(args[args.length - 3]).toBe("--chdir")
    expect(args[args.length - 2]).toBe(worktree)
    expect(args[args.length - 1]).toBe("--")
  })

  test("the launcher forwards egress, applies the configured rlimits, and propagates the exit code", () => {
    const { policy } = fixture()
    const script = wrapperScript(policy)
    expect(script).toContain(`socat TCP-LISTEN:${policy.proxyPort},bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:${policy.proxySocket}`)
    expect(script).toContain(`ulimit -t ${policy.limits.cpuSeconds}`)
    expect(script).toContain(`ulimit -u ${policy.limits.maxProcesses}`)
    expect(script).not.toContain("ulimit -v")
    expect(script).toContain('"$@"')
    expect(script).toContain("exit $?")
    const withMemory = wrapperScript({ ...policy, limits: { ...policy.limits, memoryBytes: 1024 * 1024 } })
    expect(withMemory).toContain("ulimit -v 1024")
  })
})
