import { Service } from "@opencode/client/effect/service"
import { names as configFileNames } from "@opencode/core/config/discovery"
import { Global } from "@opencode/util/global"
import { loadInviteConfig, type InviteConfig } from "@grist-ai/logic"
import { Effect } from "effect"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServiceConfig } from "../../services/service-config"
import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "../../version"

export type CheckStatus = "pass" | "warn" | "fail"
export interface CheckResult {
  readonly name: string
  readonly status: CheckStatus
  readonly detail: string
}

const ok = (name: string, detail: string): CheckResult => ({ name, status: "pass", detail })
const warn = (name: string, detail: string): CheckResult => ({ name, status: "warn", detail })
const fail = (name: string, detail: string): CheckResult => ({ name, status: "fail", detail })

export function summarize(results: readonly CheckResult[]) {
  return {
    pass: results.filter((r) => r.status === "pass").length,
    warn: results.filter((r) => r.status === "warn").length,
    fail: results.filter((r) => r.status === "fail").length,
  }
}

const marker: Record<CheckStatus, string> = { pass: "✓", warn: "!", fail: "✗" }

export function formatChecklist(results: readonly CheckResult[]): string {
  const lines = results.map((r) => `${marker[r.status]} ${r.name}: ${r.detail}`)
  const { pass, warn: warned, fail: failed } = summarize(results)
  const verdict =
    failed > 0 ? "doctor found problems" : warned > 0 ? "doctor found warnings" : "all checks passed"
  return [...lines, "", `${verdict} (${pass} pass, ${warned} warn, ${failed} fail)`, ""].join("\n")
}

function parseVersion(v: string): number[] {
  return v
    .replace(/^[v=\s]+/, "")
    .split(".")
    .map((part) => Number.parseInt(part.replace(/[^0-9].*$/, ""), 10))
    .map((n) => (Number.isNaN(n) ? 0 : n))
}

/** -1 when a < b, 0 when equal, 1 when a > b. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

/** Pure rendering of the auth check. Never includes the credential itself. */
export function describeInvite(invite: InviteConfig | undefined): CheckResult {
  if (!invite) {
    return fail(
      "auth",
      "not signed in — run: grist auth login --provider grist",
    )
  }
  const via = invite.kind === "api_key" ? "api key" : "invite code"
  return ok("auth", `signed in via ${via} → ${invite.gatewayUrl}`)
}

function checkBinary(): CheckResult {
  const bun = process.versions.bun ?? "unknown"
  const detail = `${OPENCODE_VERSION} (${OPENCODE_CHANNEL}) · ${process.platform}-${process.arch} · bun ${bun}`
  if (OPENCODE_VERSION === "local" || OPENCODE_VERSION === "0.0.0") {
    return warn("binary", `${detail} — dev build`)
  }
  return ok("binary", detail)
}

function checkGlobalDirs(): CheckResult {
  const dirs = [
    ["config", Global.Path.config],
    ["data", Global.Path.data],
    ["state", Global.Path.state],
  ] as const
  for (const [label, dir] of dirs) {
    try {
      if (!fs.statSync(dir).isDirectory()) return fail("global dirs", `${label} is not a directory: ${dir}`)
    } catch {
      return fail("global dirs", `${label} missing and not creatable: ${dir}`)
    }
  }
  return ok("global dirs", Global.Path.config)
}

function checkProjectConfig(): CheckResult {
  let dir = process.cwd()
  for (;;) {
    for (const name of configFileNames) {
      const candidate = path.join(dir, name)
      if (fs.existsSync(candidate)) return ok("project config", candidate)
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return warn("project config", "none found — using global defaults")
}

function checkAuth(): CheckResult {
  return describeInvite(loadInviteConfig())
}

async function checkGateway(): Promise<CheckResult> {
  const invite = loadInviteConfig()
  if (!invite) return fail("gateway", "not signed in — skipping connectivity check")
  const url = `${invite.gatewayUrl}/v1/auth/config`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (response.ok) return ok("gateway", `reachable at ${invite.gatewayUrl}`)
    return warn("gateway", `${url} returned ${response.status}`)
  } catch (error) {
    return fail("gateway", `unreachable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function checkJevGate(): CheckResult {
  if (process.env.TYPESAFE_API_KEY?.trim()) {
    return ok("jev gate", "TYPESAFE_API_KEY set — live confidence gate")
  }
  return warn("jev gate", "TYPESAFE_API_KEY not set — gate runs in local shadow mode")
}

function checkWritability(): CheckResult {
  const probe = path.join(Global.Path.state, `.doctor-probe-${process.pid}`)
  try {
    fs.writeFileSync(probe, "ok")
    fs.unlinkSync(probe)
    return ok("writability", `can write to ${Global.Path.state}`)
  } catch (error) {
    return fail("writability", error instanceof Error ? error.message : String(error))
  }
}

async function checkUpdate(): Promise<CheckResult> {
  if (OPENCODE_VERSION === "local" || OPENCODE_VERSION === "0.0.0") {
    return warn("update", "dev build — skipping update check")
  }
  try {
    const response = await fetch("https://registry.npmjs.org/grist-ai/latest", {
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return warn("update", `registry returned ${response.status}`)
    const latest = (await response.json()) as { version?: string }
    if (!latest.version) return warn("update", "registry gave no version")
    const cmp = compareVersions(OPENCODE_VERSION, latest.version)
    if (cmp < 0) return warn("update", `${latest.version} available (you have ${OPENCODE_VERSION}) — run: grist update`)
    return ok("update", `grist-ai@${OPENCODE_VERSION} is current`)
  } catch {
    return warn("update", "could not reach the npm registry")
  }
}

const checkService = Effect.fn("cli.doctor.service")(function* () {
  try {
    const options = yield* ServiceConfig.options()
    const found = yield* Service.discover({ ...options, version: undefined })
    if (found?.url) return ok("background service", `running at ${found.url}`)
    return warn("background service", "not running — start with: grist service start")
  } catch (error) {
    return warn("background service", `probe failed: ${error instanceof Error ? error.message : String(error)}`)
  }
})

export default Runtime.handler(
  Commands.commands.doctor,
  Effect.fn("cli.doctor")(function* (input) {
    const results: CheckResult[] = [
      checkBinary(),
      checkGlobalDirs(),
      checkProjectConfig(),
      checkAuth(),
    ]
    results.push(yield* Effect.promise(() => checkGateway()))
    results.push(checkJevGate())
    results.push(yield* checkService())
    results.push(checkWritability())
    results.push(yield* Effect.promise(() => checkUpdate()))

    if (input.json) {
      process.stdout.write(JSON.stringify({ results, summary: summarize(results) }, null, 2) + "\n")
    } else {
      process.stdout.write(formatChecklist(results))
    }
    if (summarize(results).fail > 0) process.exitCode = 1
  }),
)
