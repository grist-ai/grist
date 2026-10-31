import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Permission } from "@opencode/schema/permission"
import { Provider } from "@opencode/schema/provider"
import { existsSync } from "node:fs"
import { Effect, Schema } from "effect"
import {
  createProvider as createCodeMapProvider,
  createMemoryStore,
  formatHits,
  formatSubgraph,
  gatewayAuthHeaders,
  loadInviteConfig,
  type CodeMapProvider,
  type OutcomeKind,
} from "@grist-ai/logic"
import { registerGristHooks } from "./hooks.js"
import { GRIST_PROVIDER_ID, PUBLIC_RUNGS, PUBLIC_RUNG_NAME, RUNG_CONTEXT_FLOOR, type Rung } from "@grist-ai/logic"

function rungModel(rung: Rung): Model.Info {
  const floor = RUNG_CONTEXT_FLOOR[rung]
  return {
    ...Model.Info.default(Provider.ID.make(GRIST_PROVIDER_ID), Model.ID.make(rung)),
    name: PUBLIC_RUNG_NAME[rung],
    limit: { context: floor, input: floor, output: 32000 },
  }
}

const PROMPT_GRIST_EXPLORE = `You are a codebase reconnaissance specialist for the Grist harness. You excel at navigating unfamiliar repositories and returning a precise digest.

Your strengths:
- Rapidly locating files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- Lead with a short digest: what matters, where it lives, and what to read next
- For clear communication, avoid using emojis
- Do not create any files, or run bash commands that modify the user's system state in any way

Complete the user's search request efficiently and report your findings clearly.`

const PROMPT_GRIST_REVIEW = `You are a code review specialist for the Grist harness. You inspect proposed changes and report findings; you never modify the workspace.

Guidelines:
- Read the diff and the surrounding code before judging
- Report a concise findings list, ordered by severity
- For each finding, give the file path, the line, what is wrong, and the concrete failure mode
- Separate blocking defects from style nits
- Do not create or edit files, and do not run commands that modify the user's system state
- Return absolute file paths and, when possible, a suggested fix in prose

Review the change and report your findings clearly.`

const PROMPT_GRIST_VERIFY = `You are a verification specialist for the Grist harness. You run the repository's build, test, and lint commands and report a pass/fail digest.

Guidelines:
- Identify the narrowest relevant package before running anything
- Run from the package directory, never the repository root, when a package scope exists
- Allowed commands: build, test, check, lint, and typecheck (for example bun run check or bun test <path>)
- Report each command, its exit status, and the decisive error lines on failure
- Do not modify files; if a check needs an edit, report it instead of making it
- For clear communication, avoid using emojis

Run the checks and report a compact pass/fail digest.`

const PROMPT_GRIST_PLAN = `You are a planning specialist for the Grist harness. You research a request and return a minimal, verifiable plan.

Guidelines:
- Explore only as much as needed to name the exact files and boundaries involved
- Return an ordered plan where each step names the file(s) to change and the command that verifies it
- Prefer the smallest change that satisfies the request; call out speculative work to drop
- Note risks, open questions, and assumptions explicitly
- Do not create or modify files, and do not run commands that change system state
- Return absolute paths

Produce a concise plan and stop.`

/** Read-only tool set shared by the exploration, review, and planning specialists. */
const READ_ONLY_PERMISSIONS: Permission.Ruleset = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "grep", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "webfetch", resource: "*", effect: "allow" },
  { action: "websearch", resource: "*", effect: "allow" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
  { action: "subagent", resource: "*", effect: "deny" },
  { action: "external_directory", resource: "*", effect: "ask" },
]

const REVIEW_DENIALS: Permission.Ruleset = [
  { action: "edit", resource: "*", effect: "deny" },
  { action: "write", resource: "*", effect: "deny" },
  { action: "patch", resource: "*", effect: "deny" },
  { action: "shell", resource: "*", effect: "deny" },
]

/** The verification specialist may only run the repository's build/test/lint commands. */
const VERIFY_PERMISSIONS: Permission.Ruleset = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "shell", resource: "bun run build*", effect: "allow" },
  { action: "shell", resource: "bun run test*", effect: "allow" },
  { action: "shell", resource: "bun run check*", effect: "allow" },
  { action: "shell", resource: "bun run lint*", effect: "allow" },
  { action: "shell", resource: "bun run typecheck*", effect: "allow" },
  { action: "shell", resource: "bun test*", effect: "allow" },
  { action: "subagent", resource: "*", effect: "deny" },
]

/**
 * The Grist control plane as an opencode v2 plugin.
 *
 * - Adds the `grist` provider (OpenAI-compatible transport pointed at the
 *   Grist gateway) with the four ladder rungs as its models. The gateway
 *   resolves each rung to its upstream model server-side; vendor ids never
 *   ship in the client. Provider registration is invite-gated.
 * - Registers the control-plane hooks: `session.prompt` (Jev gate),
 *   `session.context` (doctrine), `session."model.request"` (between-turn
 *   judgment), `session.compaction` (compaction guard), `tool.execute.before`
 *   (tool budget), `tool.execute.after` (tool stats + verify nudge), and
 *   `permission.evaluate` (auto-allow). The hooks run with shadow fallbacks
 *   when no Jev route resolves; `GRIST_CTRL=off` disables them.
 *
 * Without an invite config the provider is not registered, but the hooks stay
 * active: opencode behaves vanilla only when `GRIST_CTRL=off`.
 */
export const Plugin = define({
  id: "grist-ai.plugin",
  effect: Effect.fn(function* (ctx) {
    // R1: verified-outcomes memory (ported from v1). Created before the
    // hooks so R3 failure learning can write negative memories through the
    // same store. The store enforces the verified-outcomes gate itself —
    // unverified writes are refused there, never silently accepted here.
    const memoryStore = createMemoryStore({ cwd: ctx.location.directory })
    const defaultContainer =
      ctx.location.directory.split("/").filter(Boolean).pop() ?? "default"
    yield* registerGristHooks(
      ctx,
      memoryStore ? { store: memoryStore, container: defaultContainer } : undefined,
    )
    if (memoryStore) {
      yield* ctx.tool.transform((editor) => {
        editor.add({
          name: "memory",
          description:
            "Verified-outcomes memory for this codebase. Actions: 'recall' (search prior verified learnings by query before assuming ownership or conventions), 'remember' (persist a learning ONLY with a verified outcome: tests_passed, user_approved, or user_corrected — anything else is refused), 'status' (backend health). Container defaults to this repository.",
          input: Schema.Struct({
            action: Schema.Literals(["recall", "remember", "status"]),
            query: Schema.optional(Schema.String),
            content: Schema.optional(Schema.String),
            outcome: Schema.optional(Schema.Literals(["tests_passed", "user_approved", "user_corrected"])),
            container: Schema.optional(Schema.String),
          }),
          options: { codemode: false },
          execute: (input, toolCtx) =>
            Effect.promise(async () => {
              const container = input.container ?? defaultContainer
              try {
                if (input.action === "status") {
                  const status = await memoryStore.status()
                  return {
                    content: `[grist:memory] backend=${status.backend} available=${status.available} detail=${status.detail}`,
                  }
                }
                if (input.action === "recall") {
                  const query = (input.query ?? "").trim()
                  if (!query) return { content: "[grist:memory] recall requires a query" }
                  const status = await memoryStore.status()
                  const hits = await memoryStore.recall({ query, container, limit: 8 })
                  return { content: formatHits({ query, hits, backend: status.backend }) }
                }
                const content = (input.content ?? "").trim()
                const outcome = input.outcome as OutcomeKind | undefined
                if (!content || !outcome) {
                  return {
                    content:
                      "[grist:memory] remember requires content and a verified outcome (tests_passed | user_approved | user_corrected)",
                  }
                }
                const record = await memoryStore.remember({
                  content,
                  container,
                  outcome,
                  sessionID: String(toolCtx.sessionID),
                })
                if (!record) {
                  return {
                    content:
                      "[grist:memory] not stored — only verified outcomes are persisted (tests_passed, user_approved, user_corrected)",
                  }
                }
                return { content: `[grist:memory] stored id=${record.id} outcome=${record.outcome} container=${record.container}` }
              } catch (error) {
                return { content: `[grist:memory] error: ${error instanceof Error ? error.message : String(error)}` }
              }
            }),
        })
      })
    }
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("grist-explore"), (item) => {
        item.name = Agent.Name.make("Grist Explore")
        item.description =
          "Read-only codebase explorer for unfamiliar code. Use it to map files, trace symbols, and return absolute paths plus a compact digest."
        item.system = PROMPT_GRIST_EXPLORE
        item.mode = "subagent"
        item.hidden = false
        item.permissions.push(...READ_ONLY_PERMISSIONS)
      })

      editor.update(Agent.ID.make("grist-review"), (item) => {
        item.name = Agent.Name.make("Grist Review")
        item.description =
          "Code reviewer for non-trivial edits. Use it before declaring work done to get a findings list on the diff; it never writes."
        item.system = PROMPT_GRIST_REVIEW
        item.mode = "subagent"
        item.hidden = false
        item.permissions.push(...READ_ONLY_PERMISSIONS, ...REVIEW_DENIALS)
      })

      editor.update(Agent.ID.make("grist-verify"), (item) => {
        item.name = Agent.Name.make("Grist Verify")
        item.description =
          "Test and build runner. Use it instead of running build, test, lint, or typecheck inline; it returns a pass/fail digest."
        item.system = PROMPT_GRIST_VERIFY
        item.mode = "subagent"
        item.hidden = false
        item.permissions.push(...VERIFY_PERMISSIONS)
      })

      editor.update(Agent.ID.make("grist-plan"), (item) => {
        item.name = Agent.Name.make("Grist Plan")
        item.description =
          "Plan researcher for multi-step work. Use it to turn a request into an ordered, verifiable plan before editing; it never writes."
        item.system = PROMPT_GRIST_PLAN
        item.mode = "subagent"
        item.hidden = false
        item.permissions.push(...READ_ONLY_PERMISSIONS)
      })
    })
    // R2: code map (ported from v1; Graphify locked by the 2026-09-23
    // bake-off). Reads graphify-out/graph.json; the `augment` action merges
    // Express route registrations (@grist-ai/route-graph) into
    // graph.aug.json, which then takes precedence — that closes the
    // route-registration blind spot both bake-off tools shared.
    const codeMapBase = `${ctx.location.directory}/graphify-out/graph.json`
    const codeMapAug = `${ctx.location.directory}/graphify-out/graph.aug.json`
    let codeMapProvider: CodeMapProvider | undefined = createCodeMapProvider({
      cwd: ctx.location.directory,
      graphPath:
        process.env.GRIST_GRAPHIFY_PATH ?? (existsSync(codeMapAug) ? codeMapAug : codeMapBase),
    })
    if (codeMapProvider) {
      yield* ctx.tool.transform((editor) => {
        editor.add({
          name: "code_map",
          description:
            "Structural code map for this repository (Graphify graph). Actions: 'status' (graph availability/size), 'search' (find nodes by label or file), 'subgraph' (blast-radius neighborhood of a seed file/symbol, ranked by connectedness — use for escalation context instead of reading the whole repo), 'augment' (merge Express route registrations into the graph so 'which endpoint reaches this code?' resolves; writes graph.aug.json). Requires graphify-out/graph.json (build with Graphify); status reports when it is missing.",
          input: Schema.Struct({
            action: Schema.Literals(["status", "search", "subgraph", "augment"]),
            query: Schema.optional(Schema.String),
            seed: Schema.optional(Schema.String),
            hops: Schema.optional(Schema.Number),
          }),
          options: { codemode: false },
          execute: (input) =>
            Effect.promise(async () => {
              const provider = codeMapProvider
              if (!provider) return { content: "[grist:code-map] provider disabled" }
              try {
                if (input.action === "status") {
                  const status = await provider.status()
                  return {
                    content: `[grist:code-map] provider=${status.id} available=${status.available} detail=${status.detail} graph=${status.graphPath ?? ""}`,
                  }
                }
                if (input.action === "search") {
                  const query = (input.query ?? "").trim()
                  if (!query) return { content: "[grist:code-map] search requires a query" }
                  const nodes = await provider.search(query, 20)
                  if (nodes.length === 0) return { content: `[grist:code-map] no nodes match ${JSON.stringify(query)}` }
                  return {
                    content: nodes
                      .map((n) => `- ${n.label}${n.kind ? ` (${n.kind})` : ""}${n.sourceFile ? ` @ ${n.sourceFile}` : ""} [${n.id}]`)
                      .join("\n"),
                  }
                }
                if (input.action === "subgraph") {
                  const seed = (input.seed ?? "").trim()
                  if (!seed) return { content: "[grist:code-map] subgraph requires a seed" }
                  const sub = await provider.subgraph({ seed, hops: input.hops ?? 2 })
                  if (!sub) return { content: `[grist:code-map] no subgraph for seed ${JSON.stringify(seed)} (graph missing or seed not found)` }
                  return { content: formatSubgraph(sub) }
                }
                // augment: route registrations → graph.aug.json (non-destructive)
                const mod = (await import("@grist-ai/route-graph")) as unknown as {
                  augmentGraph: (opts: {
                    graphPath: string
                    repoDir: string
                    outPath?: string
                    write?: boolean
                  }) => Promise<{
                    registrations: number
                    nodesAdded: number
                    linksAdded: number
                    resolved: number
                    unresolved: number
                  }>
                }
                const stats = await mod.augmentGraph({
                  graphPath: codeMapBase,
                  repoDir: ctx.location.directory,
                  outPath: codeMapAug,
                  write: true,
                })
                codeMapProvider = createCodeMapProvider({
                  cwd: ctx.location.directory,
                  graphPath: codeMapAug,
                })
                return {
                  content: `[grist:code-map] augmented: registrations=${stats.registrations} nodesAdded=${stats.nodesAdded} linksAdded=${stats.linksAdded} resolved=${stats.resolved} unresolved=${stats.unresolved} → graphify-out/graph.aug.json now in use`,
                }
              } catch (error) {
                return { content: `[grist:code-map] error: ${error instanceof Error ? error.message : String(error)}` }
              }
            }),
        })
      })
    }
    const invite = loadInviteConfig()
    if (!invite) return
    yield* ctx.provider.transform((editor) => {
      if (editor.get(GRIST_PROVIDER_ID)) return
      editor.add({
        info: {
          id: Provider.ID.make(GRIST_PROVIDER_ID),
          name: "Grist",
          activation: "auto",
          package: "@opencode/ai/providers/openai-compatible",
          settings: {
            baseURL: `${invite.gatewayUrl}/v1`,
            apiKey: invite.code,
          },
          headers: {
            "HTTP-Referer": "https://github.com/grist-ai/grist",
            "X-Title": "Grist",
            ...gatewayAuthHeaders(invite),
          },
        },
        models: PUBLIC_RUNGS.map(rungModel),
      })
    })
  }),
})
