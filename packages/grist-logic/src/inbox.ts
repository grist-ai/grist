import { gatewayAuthHeaders, type InviteConfig } from "./invite-config.js"
import { GatewayHttpError } from "./invite-client.js"

/**
 * The approvals inbox client (next-block spec §7, D6 Option 2): the
 * unattended-run side of the inbox — posting question items, reading
 * them back (the runner's resume pass), and the human decision calls
 * the CLI makes. The gateway owns the state machine; decisions are
 * human-only there (an account credential decides, never a delegated
 * API key — the gateway enforces it).
 */

export const INBOX_BOUNDARIES = ["send", "deploy", "spend-beyond-envelope", "write-outside-environment"] as const
export type InboxBoundary = (typeof INBOX_BOUNDARIES)[number]

export type InboxItemState = "pending" | "approved" | "denied" | "expired"

export interface InboxItemWire {
  id: string
  team_id: string
  source: "envelope_breach" | "ask_human" | "question"
  boundary: InboxBoundary
  state: InboxItemState
  question: string
  detail: Record<string, unknown>
  creator_user_id: string
  request_id: string | null
  session_id: string | null
  answer: string | null
  decided_by_user_id: string | null
  created_at: number
  expires_at: number
  decided_at: number | null
}

export interface PostInboxItemInput {
  source: "ask_human" | "question"
  boundary: InboxBoundary
  question: string
  requestId?: string
  sessionId?: string
  detail?: Record<string, unknown>
}

export interface InboxClientDeps {
  fetchFn?: typeof fetch
}

type Invite = Pick<InviteConfig, "code" | "kind" | "gatewayUrl">

async function inboxJson<T>(
  config: Invite,
  path: string,
  body: Record<string, unknown>,
  deps: InboxClientDeps,
): Promise<T> {
  const fetchFn = deps.fetchFn ?? fetch
  const response = await fetchFn(`${config.gatewayUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...gatewayAuthHeaders(config) },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const reason = typeof payload.reason === "string" ? payload.reason : undefined
    const message = typeof payload.error === "string" ? payload.error : `Gateway request failed (${response.status})`
    throw new GatewayHttpError(response.status, reason ? `${message} (${reason})` : message)
  }
  return payload as T
}

/** Post a question/escalation item from an unattended run. */
export async function postInboxItem(
  config: Invite,
  input: PostInboxItemInput,
  deps: InboxClientDeps = {},
): Promise<InboxItemWire> {
  const result = await inboxJson<{ item: InboxItemWire }>(
    config,
    "/v1/inbox/items",
    {
      source: input.source,
      boundary: input.boundary,
      question: input.question,
      request_id: input.requestId,
      session_id: input.sessionId,
      detail: input.detail,
    },
    deps,
  )
  return result.item
}

/** List the team's inbox items (newest first), optionally by state. */
export async function listInboxItems(
  config: Invite,
  input: { state?: InboxItemState; limit?: number } = {},
  deps: InboxClientDeps = {},
): Promise<InboxItemWire[]> {
  const result = await inboxJson<{ items: InboxItemWire[] }>(
    config,
    "/v1/inbox/list",
    { state: input.state, limit: input.limit },
    deps,
  )
  return result.items
}

/**
 * Record a human decision. The gateway refuses this for delegated API
 * keys (`deciding_requires_account_auth`) — surface that error as-is.
 */
export async function decideInboxItem(
  config: Invite,
  input: { itemId: string; decision: "approve" | "deny"; answer?: string },
  deps: InboxClientDeps = {},
): Promise<{ item: InboxItemWire; request?: { id: string; state: string } | null }> {
  return inboxJson(
    config,
    "/v1/inbox/decide",
    { item_id: input.itemId, decision: input.decision, answer: input.answer },
    deps,
  )
}
