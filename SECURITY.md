# Security

## Reporting a vulnerability

Do not open a public issue. Use the GitHub Security Advisory
["Report a Vulnerability"](https://github.com/grist-ai/grist/security/advisories/new)
tab on this repo.

We do not accept AI-generated security reports — they are closed on sight.

## Threat model

### The agent (local)

Grist is an AI coding assistant that runs on your machine with access to
powerful tools: shell execution, file operations, web access.

**No sandbox.** The permission system is a UX feature — it prompts before
commands, writes, etc. — not security isolation. If you need true isolation,
run Grist inside a Docker container or VM.

### The gateway (server)

Self-hosters and the hosted service run a Grist gateway that holds:

- per-user **provider keys** (OpenRouter / Vercel AI Gateway / OpenAI-compatible),
  encrypted at rest, never logged, never returned by any API
- the model ladder config and the Jev gate
- `grist_sk_...` API key hashes (keys are shown once at creation)

Provider keys are the crown jewels: a leaked gateway database is a leaked
set of inference credentials. Secure the gateway like a secret store —
private network, encrypted backups, minimal admin access.

### Out of scope

| Category | Rationale |
| --- | --- |
| **Server access when opted-in** | Enabling server mode means API access is expected |
| **Sandbox escapes** | The permission system is not a sandbox (see above) |
| **LLM provider data handling** | Data sent to your configured provider is governed by their policies |
| **MCP server behavior** | External MCP servers you configure are outside our trust boundary |
| **Malicious config files** | Users control their own config; modifying it is not an attack vector |

### Server mode

Server mode is opt-in. When enabled, set `OPENCODE_SERVER_PASSWORD` to require
HTTP Basic Auth — without it the server runs unauthenticated (with a warning).
Securing it is the operator's responsibility.
