/**
 * Conservative credential-shape scan for team memory content (spec v2 §7).
 *
 * The harness scans at capture, before anything is queued for push; the
 * gateway scans again on receipt and rejects + notifies. The pattern set
 * intentionally mirrors `packages/grist-gateway/src/secrets-scan.ts` —
 * the two must stay aligned (a client-only pattern wastes a round trip, a
 * gateway-only pattern means the client queues entries that can never
 * sync). Patterns are anchored to credential shapes — provider key
 * prefixes with realistic lengths, private key blocks, token formats —
 * never generic words like "password" or assignment syntax, because
 * memory entries legitimately discuss code that mentions those. A hit
 * returns only the pattern kind, never the matched text.
 */

const PATTERNS: { kind: string; pattern: RegExp }[] = [
  // PEM / OpenSSH private key blocks.
  { kind: "private_key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  // Grist's own credentials: agent API keys and connector tokens
  // (`grist_sk_` / `grist_mcn_` plus 64 hex chars — see codes.ts).
  { kind: "grist_key", pattern: /\bgrist_(?:sk|mcn)_[0-9a-f]{64}\b/i },
  // OpenAI / Anthropic style keys: sk-..., sk-proj-..., sk-ant-....
  { kind: "sk_key", pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/ },
  // GitHub tokens: classic PAT / OAuth / app tokens and fine-grained PATs.
  { kind: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { kind: "github_token", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/ },
  // AWS access key IDs.
  { kind: "aws_key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  // Slack tokens.
  { kind: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  // Google API keys.
  { kind: "google_key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  // JWTs (three base64url segments, header starts with eyJ).
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  // Explicit Bearer credentials with a token-shaped value.
  { kind: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/i },
]

/** The kind of the first credential shape found in `content`, if any. */
export function findSecretKind(content: string): string | undefined {
  for (const { kind, pattern } of PATTERNS) {
    if (pattern.test(content)) return kind
  }
  return undefined
}
