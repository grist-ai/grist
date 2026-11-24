import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  buildPolicy,
  egressAllowlist,
  hostAllowed,
  jailedEnv,
  policySummary,
  type SandboxCapability,
} from "../src/environment/sandbox-policy"

const home = "/home/tester"
const directory = "/home/tester/worktrees/alpha"

describe("SandboxPolicy egress allowlist", () => {
  test("defaults cover registries, providers, the gateway, and GitHub", () => {
    const list = egressAllowlist({})
    for (const host of ["registry.npmjs.org", "pypi.org", "api.openai.com", "api.anthropic.com", "gristcode.tech", "github.com"]) {
      expect(list).toContain(host)
    }
  })

  test("merges configured base-URL hosts and the explicit allowlist variable", () => {
    const list = egressAllowlist({
      OPENAI_BASE_URL: "https://llm.internal.example:8443/v1",
      GRIST_SANDBOX_EGRESS_ALLOWLIST: "models.corp.example, cache.corp.example",
    })
    expect(list).toContain("llm.internal.example")
    expect(list).toContain("models.corp.example")
    expect(list).toContain("cache.corp.example")
  })

  test("hostAllowed admits exact hosts and subdomains, never lookalikes", () => {
    const list = ["npmjs.org", "api.openai.com"]
    expect(hostAllowed(list, "npmjs.org")).toBe(true)
    expect(hostAllowed(list, "registry.npmjs.org")).toBe(true)
    expect(hostAllowed(list, "evilnpmjs.org")).toBe(false)
    expect(hostAllowed(list, "npmjs.org.evil.example")).toBe(false)
    expect(hostAllowed(list, "API.OPENAI.COM")).toBe(true)
    expect(hostAllowed(list, "api.openai.com:443")).toBe(true)
    expect(hostAllowed(list, "openai.com")).toBe(false)
  })
})

describe("SandboxPolicy construction", () => {
  test("scratch lives inside the worktree; credential locations resolve under the home", () => {
    const policy = buildPolicy({ directory, home, sourceEnv: {} })
    expect(policy.scratch).toBe(path.join(directory, ".grist", "sandbox"))
    expect(policy.scratchHome).toBe(path.join(directory, ".grist", "sandbox", "home"))
    expect(policy.proxySocket).toBe(path.join(directory, ".grist", "sandbox", "proxy.sock"))
    expect(policy.credentialDirs).toContain(path.join(home, ".ssh"))
    expect(policy.credentialDirs).toContain(path.join(home, ".aws"))
    expect(policy.credentialFiles).toContain(path.join(home, ".netrc"))
  })

  test("limits default to CPU and process ceilings; memory is opt-in", () => {
    const policy = buildPolicy({ directory, home, sourceEnv: {} })
    expect(policy.limits.cpuSeconds).toBe(1800)
    expect(policy.limits.maxProcesses).toBe(1024)
    expect(policy.limits.memoryBytes).toBeUndefined()
    const withMemory = buildPolicy({ directory, home, sourceEnv: { GRIST_SANDBOX_MEMORY_MB: "512" } })
    expect(withMemory.limits.memoryBytes).toBe(512 * 1024 * 1024)
  })
})

describe("SandboxPolicy jailedEnv", () => {
  const policy = buildPolicy({ directory, home, sourceEnv: {} })

  test("ambient credentials never cross; the allowlisted ambient basics do", () => {
    const env = jailedEnv({
      ambient: { PATH: "/usr/bin", TERM: "xterm", OPENAI_API_KEY: "sk-secret", AWS_SECRET_ACCESS_KEY: "aws-secret" },
      explicit: undefined,
      extendEnv: true,
      policy,
    })
    expect(env.PATH).toBe("/usr/bin")
    expect(env.TERM).toBe("xterm")
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(Object.values(env)).not.toContain("sk-secret")
  })

  test("explicit caller variables are the run's hand-off and pass verbatim, credentials included", () => {
    const env = jailedEnv({
      ambient: { PATH: "/usr/bin" },
      explicit: { OPENAI_API_KEY: "sk-handed-over", CUSTOM_FLAG: "1" },
      extendEnv: true,
      policy,
    })
    expect(env.OPENAI_API_KEY).toBe("sk-handed-over")
    expect(env.CUSTOM_FLAG).toBe("1")
  })

  test("driver wiring always wins: HOME, TMPDIR, and the egress proxy", () => {
    const env = jailedEnv({
      ambient: { HOME: home, HTTP_PROXY: "http://elsewhere:1" },
      explicit: { HOME: "/somewhere/else" },
      extendEnv: true,
      policy,
    })
    expect(env.HOME).toBe(policy.scratchHome)
    expect(env.TMPDIR).toBe(policy.scratchTmp)
    expect(env.HTTP_PROXY).toBe(`http://127.0.0.1:${policy.proxyPort}`)
    expect(env.HTTPS_PROXY).toBe(`http://127.0.0.1:${policy.proxyPort}`)
  })

  test("without extendEnv nothing ambient passes, and PATH falls back to the system default", () => {
    const env = jailedEnv({ ambient: { PATH: "/opt/custom/bin", TERM: "xterm" }, explicit: undefined, extendEnv: false, policy })
    expect(env.TERM).toBeUndefined()
    expect(env.PATH).toContain("/usr/bin")
    expect(env.PATH).not.toContain("/opt/custom/bin")
  })
})

describe("SandboxPolicy policySummary (the honesty matrix)", () => {
  const policy = buildPolicy({ directory, home, sourceEnv: {} })
  const available: SandboxCapability = { backend: "bwrap", available: true }

  test("linux with a working backend: every surface full, backend named", () => {
    const summary = policySummary({ platform: "linux", capability: available, policy })
    expect(summary.backend).toBe("bwrap")
    expect(summary.filesystem.status).toBe("full")
    expect(summary.network.status).toBe("full")
    expect(summary.environment.status).toBe("full")
    expect(summary.limits.status).toBe("full")
    expect(summary.network.note).toContain("proxy")
    expect(summary.egressAllowlist).toContain("registry.npmjs.org")
  })

  test("unavailable backend: every surface unavailable with the reason, on any platform", () => {
    const summary = policySummary({
      platform: "linux",
      capability: { backend: "bwrap", available: false, reason: "bubblewrap (bwrap) was not found on PATH" },
      policy,
    })
    expect(summary.filesystem.status).toBe("unavailable")
    expect(summary.network.status).toBe("unavailable")
    expect(summary.filesystem.note).toContain("not found on PATH")
  })

  test("macOS: network and limits are degraded with the gaps named, filesystem stays full", () => {
    const summary = policySummary({
      platform: "darwin",
      capability: { backend: "sandbox-exec", available: true },
      policy,
    })
    expect(summary.backend).toBe("sandbox-exec")
    expect(summary.filesystem.status).toBe("full")
    expect(summary.network.status).toBe("degraded")
    expect(summary.network.note).toContain("per-host")
    expect(summary.limits.status).toBe("degraded")
  })
})
