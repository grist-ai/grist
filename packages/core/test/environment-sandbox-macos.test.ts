import { describe, expect, test } from "bun:test"
import path from "node:path"
import { buildPolicy } from "../src/environment/sandbox-policy"
import { profilePath, profileText } from "../src/environment/sandbox-macos"

const home = "/Users/tester"
const worktree = "/Users/tester/worktrees/alpha"
const policy = buildPolicy({ directory: worktree, home, sourceEnv: {} })
const profile = profileText(policy)

describe("SandboxMacos profile generation", () => {
  test("the profile is recorded inside the environment's scratch", () => {
    expect(profilePath(policy)).toBe(path.join(worktree, ".grist", "sandbox", "sandbox.sb"))
  })

  test("writes are denied by default and allowed only inside the worktree and temp", () => {
    expect(profile.startsWith("(version 1)")).toBe(true)
    expect(profile).toContain("(allow default)")
    const deny = profile.indexOf("(deny file-write*)")
    const allowWorktree = profile.indexOf(`(allow file-write* (subpath "${worktree}"))`)
    expect(deny).toBeGreaterThan(-1)
    expect(allowWorktree).toBeGreaterThan(deny)
    expect(profile).toContain('(allow file-write* (subpath "/tmp"))')
  })

  test("the home is read-denied with the worktree carved back, and credential locations are denied last", () => {
    const denyHome = profile.indexOf(`(deny file-read* (subpath "${home}"))`)
    const allowWorktree = profile.indexOf(`(allow file-read* (subpath "${worktree}"))`)
    expect(denyHome).toBeGreaterThan(-1)
    expect(allowWorktree).toBeGreaterThan(denyHome)
    // SBPL is last-match-wins: the credential denies must come after the
    // worktree carve-back so a credential dir inside the worktree still loses.
    const ssh = profile.indexOf(`(deny file-read* file-write* (subpath "${path.join(home, ".ssh")}"))`)
    const aws = profile.indexOf(`(deny file-read* file-write* (subpath "${path.join(home, ".aws")}"))`)
    const netrc = profile.indexOf(`(deny file-read* file-write* (literal "${path.join(home, ".netrc")}"))`)
    expect(ssh).toBeGreaterThan(allowWorktree)
    expect(aws).toBeGreaterThan(allowWorktree)
    expect(netrc).toBeGreaterThan(allowWorktree)
  })

  test("network is port-class only — deny all, then 80/443 — with the per-host gap visible in the text", () => {
    const deny = profile.indexOf("(deny network*)")
    const allow443 = profile.indexOf('(allow network-outbound (remote tcp "*:443"))')
    const allow80 = profile.indexOf('(allow network-outbound (remote tcp "*:80"))')
    expect(deny).toBeGreaterThan(-1)
    expect(allow443).toBeGreaterThan(deny)
    expect(allow80).toBeGreaterThan(deny)
    // No rule names a host: the degraded network surface is a property of
    // the mechanism, and the policy summary says so.
    expect(profile).not.toContain("registry.npmjs.org")
  })
})
