import fs from "fs"
import os from "os"
import path from "path"
import { Process } from "@/util/process"
import { gristLog, gristWarn } from "../debug"

const DEFAULT_PORT = 6767
const DEFAULT_BASE = `http://127.0.0.1:${DEFAULT_PORT}`

export type ManagedLocal = {
  baseURL: string
  apiKey?: string
  managed: boolean
}

let boot: Promise<ManagedLocal | undefined> | undefined
let child: Process.Child | undefined

/**
 * Ensure Supermemory local is reachable for Grist.
 *
 * Supermemory local is MIT and ships as a self-hosted **binary** (not an
 * in-process npm library). Grist manages it as a sidecar — same idea as LSP —
 * so you don't need a separate terminal for `supermemory-server`.
 */
export function ensureSupermemoryLocal(input?: {
  baseURL?: string
  fetch?: typeof globalThis.fetch
}): Promise<ManagedLocal | undefined> {
  boot ??= bootSupermemoryLocal(input)
  return boot
}

export function resolveSupermemoryBinary(): string | undefined {
  const override = process.env.SUPERMEMORY_BIN?.trim()
  if (override && fs.existsSync(override)) return override

  const home = os.homedir()
  const candidates = [
    path.join(home, ".supermemory", "bin", "supermemory-server"),
    path.join(home, ".local", "bin", "supermemory-server"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  const fromPath = Bun.which("supermemory-server")
  if (fromPath) return fromPath
  return undefined
}

async function bootSupermemoryLocal(input?: {
  baseURL?: string
  fetch?: typeof globalThis.fetch
}): Promise<ManagedLocal | undefined> {
  if (process.env.GRIST_MEMORY_MANAGE === "off") return undefined

  const baseURL = (
    input?.baseURL ??
    process.env.SUPERMEMORY_BASE_URL ??
    process.env.SUPERMEMORY_API_URL ??
    DEFAULT_BASE
  ).replace(/\/$/, "")
  const fetchFn = input?.fetch ?? globalThis.fetch
  const existingKey = (process.env.SUPERMEMORY_API_KEY ?? "").trim() || undefined

  if (await healthy(baseURL, fetchFn)) {
    return { baseURL, apiKey: existingKey, managed: false }
  }

  if (!isLoopback(baseURL)) {
    gristWarn(`[grist:memory] supermemory not reachable at ${baseURL}`)
    return undefined
  }

  const bin = resolveSupermemoryBinary()
  if (!bin) {
    gristWarn(
      "[grist:memory] supermemory-server not installed. Run: bunx supermemory local install — falling back to file store",
    )
    return undefined
  }

  const dataDir =
    process.env.SUPERMEMORY_DATA_DIR?.trim() || path.join(os.homedir(), ".grist", "supermemory")
  fs.mkdirSync(dataDir, { recursive: true })

  const port = portFromURL(baseURL) ?? DEFAULT_PORT
  gristLog(`[grist:memory] starting supermemory-server on :${port} (data=${dataDir})`)

  let apiKey = existingKey
  child = Process.spawn([bin], {
    env: {
      PORT: String(port),
      SUPERMEMORY_PORT: String(port),
      SUPERMEMORY_DATA_DIR: dataDir,
    },
    cwd: dataDir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })

  const onChunk = (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8")
    const match = text.match(/api key\s+(sm_\S+)/i)
    if (match?.[1] && !apiKey) apiKey = match[1]
  }
  child.stdout?.on("data", onChunk)
  child.stderr?.on("data", onChunk)
  child.on("exit", (code) => {
    gristWarn(`[grist:memory] supermemory-server exited code=${code}`)
    child = undefined
    boot = undefined
  })

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (await healthy(baseURL, fetchFn)) {
      if (apiKey && !process.env.SUPERMEMORY_API_KEY) {
        process.env.SUPERMEMORY_API_KEY = apiKey
      }
      gristLog(`[grist:memory] supermemory ready at ${baseURL}`)
      return { baseURL, apiKey: apiKey ?? existingKey, managed: true }
    }
    await Bun.sleep(400)
  }

  gristWarn("[grist:memory] supermemory-server failed to become ready — falling back to file store")
  child.kill()
  child = undefined
  boot = undefined
  return undefined
}

async function healthy(baseURL: string, fetchFn: typeof fetch) {
  try {
    const response = await fetchFn(`${baseURL}/v4/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "ping", limit: 1 }),
      signal: AbortSignal.timeout(1500),
    })
    return response.status < 500
  } catch {
    return false
  }
}

function isLoopback(url: string) {
  try {
    const host = new URL(url).hostname
    return host === "localhost" || host === "127.0.0.1" || host === "::1"
  } catch {
    return false
  }
}

function portFromURL(url: string) {
  try {
    const port = new URL(url).port
    return port ? Number(port) : undefined
  } catch {
    return undefined
  }
}
