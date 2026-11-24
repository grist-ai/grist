import path from "node:path"
import { Environment } from "@opencode/schema/environment"

/**
 * The sandbox policy contract (spec §4.4) as data. Everything the jail
 * enforces is constructed here from the environment record and the machine:
 * allowed roots, masked credential locations, the egress allowlist, the
 * scrubbed environment, and process limits. Backends (bubblewrap on Linux,
 * sandbox-exec on macOS) translate this one policy object; the per-OS
 * honesty matrix is computed here too, so the summary a user sees and the
 * jail a run gets can never drift apart.
 */

export interface SandboxPolicy {
  /** The environment's worktree: the only pre-existing tree writable (and the cwd root) inside the jail. */
  readonly worktree: string
  /** The user's real home directory. Masked inside the jail; only the worktree and scratch stay visible. */
  readonly home: string
  /** Per-environment scratch root: `<worktree>/.grist/sandbox`. Holds the jail's HOME, TMPDIR, proxy socket and recorded policy. */
  readonly scratch: string
  readonly scratchHome: string
  readonly scratchTmp: string
  readonly proxySocket: string
  /** TCP port the in-jail forwarder listens on. Constant: every jail has its own network namespace. */
  readonly proxyPort: number
  readonly egressAllowlist: ReadonlyArray<string>
  readonly limits: {
    readonly cpuSeconds?: number
    readonly maxProcesses?: number
    readonly memoryBytes?: number
  }
  /** Absolute paths of credential directories: unreachable inside the jail and through the driver's file view. */
  readonly credentialDirs: ReadonlyArray<string>
  /** Absolute paths of credential files, masked the same way. */
  readonly credentialFiles: ReadonlyArray<string>
}

/** The backend that would enforce the jail on this machine, before tooling is probed. */
export type SandboxBackend = Environment.PolicySummary["backend"]

export interface SandboxCapability {
  readonly backend: SandboxBackend
  readonly available: boolean
  /** Why the sandbox cannot run here, when `available` is false. */
  readonly reason?: string
}

export const PROXY_PORT = 18337

const CREDENTIAL_DIRS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".azure",
  ".kube",
  ".docker",
  ".config/gcloud",
  ".local/share/keyrings",
]

const CREDENTIAL_FILES = [".netrc", ".git-credentials", ".npmrc", ".pypirc"]

/**
 * Default egress allowlist: package registries, the provider endpoints a
 * run is normally configured for, the Grist gateway, and GitHub (agent runs
 * clone and fetch). Hosts from the run's own configuration (base URLs,
 * GRIST_SANDBOX_EGRESS_ALLOWLIST) merge in at policy construction.
 */
const DEFAULT_EGRESS_HOSTS = [
  // Package registries
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "static.crates.io",
  "proxy.golang.org",
  "sum.golang.org",
  "repo.maven.apache.org",
  "plugins.gradle.org",
  "rubygems.org",
  "api.nuget.org",
  "huggingface.co",
  "cdn-lfs.huggingface.co",
  // Provider endpoints
  "api.openai.com",
  "api.anthropic.com",
  "openrouter.ai",
  "generativelanguage.googleapis.com",
  "ai-gateway.vercel.sh",
  // Grist gateway
  "gristcode.tech",
  "grist.lol",
  // GitHub
  "github.com",
  "api.github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
]

const BASE_URL_ENV_VARS = ["OPENAI_BASE_URL", "ANTHROPIC_BASE_URL", "GRIST_GATEWAY_URL"]

/** Ambient variables a jailed process may inherit. Everything else ambient is dropped; caller-set variables are separate. */
const AMBIENT_ENV_ALLOWLIST = ["PATH", "TERM", "COLORTERM", "LANG", "LC_ALL", "LC_CTYPE", "TZ"]

export const egressAllowlist = (sourceEnv: NodeJS.ProcessEnv): ReadonlyArray<string> => {
  const hosts = new Set(DEFAULT_EGRESS_HOSTS)
  for (const name of BASE_URL_ENV_VARS) {
    const value = sourceEnv[name]
    if (!value) continue
    try {
      hosts.add(new URL(value).hostname.toLowerCase())
    } catch {
      // A malformed base URL is the caller's configuration error elsewhere; it grants no egress.
    }
  }
  for (const entry of (sourceEnv.GRIST_SANDBOX_EGRESS_ALLOWLIST ?? "").split(",")) {
    const host = entry.trim().toLowerCase()
    if (host) hosts.add(host)
  }
  return [...hosts].toSorted()
}

/** An allowlist entry admits the host itself and its subdomains (`npmjs.org` admits `registry.npmjs.org`, never `evilnpmjs.org`). */
export const hostAllowed = (allowlist: ReadonlyArray<string>, rawHost: string): boolean => {
  const host = rawHost.toLowerCase().replace(/:\d+$/, "").replace(/\.$$/, "")
  return allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`))
}

export const buildPolicy = (input: {
  readonly directory: string
  readonly home: string
  readonly sourceEnv: NodeJS.ProcessEnv
}): SandboxPolicy => {
  const scratch = path.join(input.directory, ".grist", "sandbox")
  const cpuSeconds = positiveInt(input.sourceEnv.GRIST_SANDBOX_CPU_SECONDS) ?? 1800
  const maxProcesses = positiveInt(input.sourceEnv.GRIST_SANDBOX_MAX_PROCESSES) ?? 1024
  const memoryMb = positiveInt(input.sourceEnv.GRIST_SANDBOX_MEMORY_MB)
  return {
    worktree: input.directory,
    home: input.home,
    scratch,
    scratchHome: path.join(scratch, "home"),
    scratchTmp: path.join(scratch, "tmp"),
    proxySocket: path.join(scratch, "proxy.sock"),
    proxyPort: PROXY_PORT,
    egressAllowlist: egressAllowlist(input.sourceEnv),
    limits: {
      cpuSeconds,
      maxProcesses,
      memoryBytes: memoryMb === undefined ? undefined : memoryMb * 1024 * 1024,
    },
    credentialDirs: CREDENTIAL_DIRS.map((relative) => path.join(input.home, relative)),
    credentialFiles: CREDENTIAL_FILES.map((relative) => path.join(input.home, relative)),
  }
}

const positiveInt = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * The environment a jailed process runs with: constructed, never inherited
 * wholesale. Ambient variables pass only through the allowlist above;
 * variables the caller set on the command itself are the run's explicit
 * hand-off and pass verbatim; the driver's own wiring (HOME, TMPDIR, the
 * egress proxy) is applied last and always wins.
 */
export const jailedEnv = (input: {
  readonly ambient: NodeJS.ProcessEnv
  readonly explicit: Record<string, string | undefined> | undefined
  readonly extendEnv: boolean | undefined
  readonly policy: SandboxPolicy
}): Record<string, string> => {
  const result: Record<string, string> = {}
  if (input.extendEnv) {
    for (const name of AMBIENT_ENV_ALLOWLIST) {
      const value = input.ambient[name]
      if (value !== undefined) result[name] = value
    }
  }
  for (const [name, value] of Object.entries(input.explicit ?? {})) {
    if (value !== undefined) result[name] = value
  }
  result.PATH ??= "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin"
  const proxy = `http://127.0.0.1:${input.policy.proxyPort}`
  result.HOME = input.policy.scratchHome
  result.TMPDIR = input.policy.scratchTmp
  result.HTTP_PROXY = proxy
  result.HTTPS_PROXY = proxy
  result.http_proxy = proxy
  result.https_proxy = proxy
  result.NO_PROXY = ""
  result.no_proxy = ""
  return result
}

/**
 * The per-OS honesty matrix (spec §4.4) as a function of the platform and
 * the probed capability. `degraded` always carries the note naming the gap.
 */
export const policySummary = (input: {
  readonly platform: NodeJS.Platform
  readonly capability: SandboxCapability
  readonly policy: SandboxPolicy
}): Environment.PolicySummary => {
  const egressAllowlist = [...input.policy.egressAllowlist]
  if (!input.capability.available) {
    const note = input.capability.reason ?? "Sandbox is not available on this machine"
    const unavailable: Environment.PolicySurface = { status: "unavailable", note }
    return {
      backend: input.capability.backend,
      filesystem: unavailable,
      network: unavailable,
      environment: unavailable,
      limits: unavailable,
      egressAllowlist,
    }
  }
  const ceilings = [
    input.policy.limits.cpuSeconds === undefined ? undefined : `CPU ${input.policy.limits.cpuSeconds}s`,
    input.policy.limits.maxProcesses === undefined ? undefined : `${input.policy.limits.maxProcesses} processes`,
    input.policy.limits.memoryBytes === undefined
      ? "memory ceiling unset (GRIST_SANDBOX_MEMORY_MB sets one)"
      : `memory ${Math.floor(input.policy.limits.memoryBytes / 1024 / 1024)}MB`,
  ].filter((entry) => entry !== undefined)
  const limits: Environment.PolicySurface = {
    status: "full",
    note: `rlimits applied by the in-jail launcher: ${ceilings.join(", ")}`,
  }
  if (input.platform === "darwin") {
    return {
      backend: "sandbox-exec",
      filesystem: {
        status: "full",
        note: "sandbox-exec profile: writes confined to the worktree, credential directories and the rest of the home denied; profile granularity is coarser than Linux namespaces",
      },
      network: {
        status: "degraded",
        note: "sandbox-exec rules are port classes, not per-host: outbound is limited to ports 80/443. The per-host egress allowlist needs a local proxy shim, which is follow-up work, not v1",
      },
      environment: { status: "full", note: "Constructed at spawn; no inherited credentials" },
      limits: { status: "degraded", note: "rlimits only; macOS has no cgroup equivalent" },
      egressAllowlist,
    }
  }
  return {
    backend: "bwrap",
    filesystem: {
      status: "full",
      note: "Mount namespace: writable only inside the worktree; the home directory is masked and credential directories are unreachable",
    },
    network: {
      status: "full",
      note: "Network namespace with no direct egress; all traffic goes through the driver's filtering proxy, which admits only allowlisted hosts",
    },
    environment: { status: "full", note: "Constructed at spawn; no inherited credentials" },
    limits,
    egressAllowlist,
  }
}

export * as SandboxPolicy from "./sandbox-policy.js"
