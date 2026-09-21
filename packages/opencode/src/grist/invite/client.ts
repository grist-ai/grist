import { gatewayAuthHeaders, loadInviteConfig, type InviteConfig } from "./config"

export class GatewayHttpError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(body)
    this.status = status
    this.body = body
  }
}

export async function validateInvite(input: { code: string; gatewayUrl: string }) {
  const response = await fetch(`${strip(input.gatewayUrl)}/v1/invite/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: input.code }),
  })
  return (await response.json()) as {
    valid: boolean
    plan?: string
    spend_cap_usd?: number
    remaining_usd?: number
  }
}

export async function fetchUsage(config: InviteConfig = requireInvite()) {
  return gatewayJson<{
    spent_usd: number
    cap_usd: number
    remaining_usd: number
    plan: string
    expires_at: string
    by_rung: { cheapest: number; medium: number; frontier: number }
  }>(config, "/v1/usage", { method: "GET" })
}

export async function fetchGateRoute(
  input: { text: string; sessionID?: string },
  config: InviteConfig = requireInvite(),
) {
  return gatewayJson<{
    rung: "cheapest" | "medium" | "frontier"
    model: { provider_id: string; model_id: string }
    difficulty: number
    sensitivity: number
    underspecified: number
    reasons: string[]
    mechanisms: { observation_pack: boolean; action_fusion: boolean }
    provider?: "jev" | "shadow"
    mode?: "normal" | "capped" | "cheapest"
    latency_ms?: number
  }>(config, "/v1/gate/route", {
    method: "POST",
    body: JSON.stringify({ text: input.text, session_id: input.sessionID }),
  })
}

export async function startCliLogin(gatewayUrl: string) {
  const response = await fetch(`${strip(gatewayUrl)}/v1/auth/device`, { method: "POST" })
  if (!response.ok) throw new GatewayHttpError(response.status, await response.text())
  return (await response.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    interval: number
    expires_in: number
  }
}

export async function pollCliLogin(gatewayUrl: string, device_code: string) {
  const response = await fetch(`${strip(gatewayUrl)}/v1/auth/device/poll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code }),
  })
  const data = (await response.json()) as { status: string; code?: string }
  if (data.status === "approved" && data.code) return { status: "approved" as const, code: data.code }
  if (data.status === "pending") return { status: "pending" as const }
  return { status: "expired" as const }
}

function requireInvite(): InviteConfig {
  const config = loadInviteConfig()
  if (!config) throw new Error("invite mode is not configured")
  return config
}

async function gatewayJson<T>(config: InviteConfig, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${config.gatewayUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...gatewayAuthHeaders(config),
      ...init.headers,
    },
  })
  const body = await response.text()
  if (response.status === 402 || !response.ok) {
    throw new GatewayHttpError(response.status, humanMessage(response.status, body))
  }
  return JSON.parse(body) as T
}

function humanMessage(status: number, body: string) {
  const parsed = parseError(body)
  if (status === 402) {
    return parsed ?? "Invite spend cap reached. Ask the founder for a top-up."
  }
  return parsed ?? body ?? `gateway HTTP ${status}`
}

function parseError(body: string) {
  if (!body) return
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    if (typeof parsed.error === "string") return parsed.error
  } catch {
    return body
  }
}

function strip(url: string) {
  return url.replace(/\/+$/, "")
}
