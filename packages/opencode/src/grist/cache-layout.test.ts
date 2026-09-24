import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { identityDoctrine, surgicalEngineer } from "./doctrine"
import {
  CACHE_RULES,
  applyBreakpoints,
  assemble,
  cacheHitRate,
  layoutEnabled,
  prefixFingerprint,
  sortTools,
  supportsExplicitBreakpoints,
} from "./cache-layout"

const IDENTITY = [
  "You are a surgical engineer.",
  "Prefer reversible, observable steps.",
]

const ENV = [
  "Here is some useful information about the environment you are running in:",
  "<env>",
  "  Working directory: /Users/tester/app",
  "  Platform: darwin",
  "  Today's date: Wed Sep 23 2026",
  "</env>",
].join("\n")

const SKILLS = [
  "Skills provide specialized instructions and workflows for specific tasks.",
  "<available_skills>",
  "  <skill><name>init</name></skill>",
  "</available_skills>",
].join("\n")

const TOOLS = ["read", "bash", "grep", "edit"]

describe("GRIST_CACHE_LAYOUT", () => {
  test("flag is off unless GRIST_CACHE_LAYOUT=1", () => {
    expect(layoutEnabled({})).toBe(false)
    expect(layoutEnabled({ GRIST_CACHE_LAYOUT: "1" })).toBe(true)
  })

  test("before: date and session id sit in the same blob as identity", () => {
    const before = [IDENTITY.join("\n"), surgicalEngineer("ses_volatile"), ENV, SKILLS].join("\n")
    expect(before).toContain("Today's date")
    expect(before).toContain("surgical engineer")
  })

  test("after: identity prefix is byte-identical when date and session nudges change", () => {
    const doctrine = identityDoctrine()
    const monday = assemble({
      identity: IDENTITY,
      doctrine,
      setup: [ENV.replace("Wed Sep 23 2026", "Mon Sep 21 2026"), SKILLS],
      nudges: "`edit_verify` applies a patch and runs its check in one call.",
    })
    const wednesday = assemble({
      identity: IDENTITY,
      doctrine,
      setup: [ENV, SKILLS],
      nudges: "Exploration through the `task` tool returns a compressed digest.",
    })
    expect(monday.prefix).toBe(wednesday.prefix)
    expect(monday.prefix).not.toContain("Today's date")
    expect(monday.setup).toContain("Mon Sep 21")
    expect(wednesday.setup).toContain("Wed Sep 23")
    expect(monday.messages).toHaveLength(2)
    expect(monday.messages[0]?.role).toBe("system")
    expect(monday.messages[1]?.role).toBe("system")
    const fingerprint = prefixFingerprint(TOOLS, monday.prefix)
    expect(fingerprint).toBe(prefixFingerprint(["grep", "edit", "bash", "read"], wednesday.prefix))
  })

  test("tool serialization order is sorted and stable", () => {
    const shuffled = sortTools({ grep: 1, bash: 2, read: 3, edit: 4 })
    expect(Object.keys(shuffled)).toEqual(["bash", "edit", "grep", "read"])
    expect(Object.keys(sortTools({ read: 1, bash: 2 }))).toEqual(Object.keys(sortTools({ bash: 2, read: 1 })))
  })

  test("breakpoints mark first and last system messages and leave conversation bytes unchanged", () => {
    const layout = assemble({
      identity: IDENTITY,
      doctrine: identityDoctrine(),
      setup: [ENV],
    })
    const conversation: ModelMessage[] = [
      { role: "user", content: "rename the helper" },
      { role: "assistant", content: "I'll edit src/graph/map.ts" },
    ]
    const marked = applyBreakpoints([...layout.messages, ...conversation])
    expect(marked[0]?.providerOptions).toMatchObject({ anthropic: { cacheControl: { type: "ephemeral" } } })
    expect(marked[1]?.providerOptions).toMatchObject({ openrouter: { cacheControl: { type: "ephemeral" } } })
    expect(marked[2]).toEqual(conversation[0])
    expect(marked[3]).toEqual(conversation[1])
    expect(JSON.stringify(marked[2])).not.toContain("cacheControl")
  })

  test("explicit breakpoints only for Anthropic-family; OpenRouter DeepSeek uses automatic prefix caching", () => {
    expect(
      supportsExplicitBreakpoints({
        providerID: "anthropic",
        id: "claude-sonnet-4",
        api: { id: "claude-sonnet-4", npm: "@ai-sdk/anthropic" },
      }),
    ).toBe(true)
    expect(
      supportsExplicitBreakpoints({
        providerID: "openrouter",
        id: "anthropic/claude-sonnet-4",
        api: { id: "anthropic/claude-sonnet-4", npm: "@openrouter/ai-sdk-provider" },
      }),
    ).toBe(true)
    expect(
      supportsExplicitBreakpoints({
        providerID: "openrouter",
        id: "deepseek/deepseek-v4.1-flash",
        api: { id: "deepseek/deepseek-v4.1-flash", npm: "@openrouter/ai-sdk-provider" },
      }),
    ).toBe(false)
  })

  test("before/after prefix contents and live cache-hit measurement plan", () => {
    const doctrine = identityDoctrine()
    const before = [IDENTITY.join("\n"), doctrine, ENV, SKILLS].join("\n")
    const after = assemble({ identity: IDENTITY, doctrine, setup: [ENV, SKILLS] })
    const rows = [
      {
        task: "cheapest/fix-hang",
        before_tokens: Math.ceil(before.length / 4),
        after_cached_tokens: Math.ceil(after.prefix.length / 4),
        after_setup_tokens: Math.ceil(after.setup.length / 4),
      },
    ]
    console.log("cache-layout prefix (chars/4)", rows)
    console.log("cache rules", CACHE_RULES)
    console.log(
      "live plan: compare gateway cache_hit=cached/input on cheapest for this task set with GRIST_CACHE_LAYOUT off vs on; TTL 5m, min 1024 tokens.",
    )
    expect(after.prefix.length).toBeLessThan(before.length)
    expect(after.prefix).not.toContain("Today's date")
    expect(after.setup).toContain("Today's date")
    expect(cacheHitRate(900, 1000)).toBe(0.9)
    expect(CACHE_RULES.maxBreakpoints).toBe(4)
    expect(CACHE_RULES.minTokens).toBe(1024)
  })

  test("split is a no-op when setup is empty", () => {
    const layout = assemble({ identity: IDENTITY, doctrine: "stable doctrine", setup: [] })
    expect(layout.messages).toHaveLength(1)
    expect(layout.setup).toBe("")
  })
})
