import { describe, expect, test } from "bun:test"
import {
  BYOK_PROVIDERS,
  ladderModel,
  parseByokProvider,
  providerEndpoints,
  resolveUpstream,
} from "./providers"
import { DEFAULT_RUNG_MODELS } from "./ladder"

describe("parseByokProvider", () => {
  test("accepts known providers case-insensitively", () => {
    expect(parseByokProvider("openrouter")).toBe("openrouter")
    expect(parseByokProvider("Vercel")).toBe("vercel")
    expect(parseByokProvider(" CUSTOM ")).toBe("custom")
  })
  test("rejects unknown or non-string input", () => {
    expect(parseByokProvider("anthropic")).toBeUndefined()
    expect(parseByokProvider("")).toBeUndefined()
    expect(parseByokProvider(undefined)).toBeUndefined()
    expect(parseByokProvider(42)).toBeUndefined()
  })
  test("BYOK_PROVIDERS lists exactly the parseable ids", () => {
    expect([...BYOK_PROVIDERS].sort()).toEqual(["custom", "openrouter", "vercel"])
  })
})

describe("providerEndpoints", () => {
  test("openrouter chat + jev endpoints", () => {
    const endpoints = providerEndpoints("openrouter")
    expect(endpoints?.chatCompletions).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(endpoints?.jevEndpoint).toContain("openrouter.ai")
    expect(endpoints?.jevModel).toBe("typesafe/jev-latest")
  })
  test("vercel chat + jev endpoints", () => {
    const endpoints = providerEndpoints("vercel")
    expect(endpoints?.chatCompletions).toBe("https://ai-gateway.vercel.sh/v1/chat/completions")
    expect(endpoints?.jevEndpoint).toContain("ai-gateway.vercel.sh")
    expect(endpoints?.jevModel).toBe("typesafe-ai/jev")
  })
  test("custom derives from base URL, empty jev", () => {
    const endpoints = providerEndpoints("custom", "https://llm.example.com/v1/")
    expect(endpoints?.chatCompletions).toBe("https://llm.example.com/v1/chat/completions")
    expect(endpoints?.jevEndpoint).toBe("")
  })
  test("custom without base URL is undefined", () => {
    expect(providerEndpoints("custom")).toBeUndefined()
    expect(providerEndpoints("custom", "   ")).toBeUndefined()
  })
})

describe("ladderModel", () => {
  test("openrouter matches the production ladder", () => {
    for (const rung of ["cheapest", "medium", "frontier", "premium"] as const) {
      expect(ladderModel("openrouter", rung, {})).toBe(DEFAULT_RUNG_MODELS[rung].modelID)
    }
  })
  test("env override wins per provider+rung", () => {
    const env = { GRIST_VERCEL_FRONTIER_MODEL: "openai/gpt-6-sol" }
    expect(ladderModel("vercel", "frontier", env)).toBe("openai/gpt-6-sol")
    expect(ladderModel("openrouter", "frontier", env)).toBe(DEFAULT_RUNG_MODELS.frontier.modelID)
  })
  test("custom has no ladder table", () => {
    expect(ladderModel("custom", "cheapest", {})).toBeUndefined()
  })
})

describe("resolveUpstream", () => {
  test("resolves openrouter rung fully", () => {
    const resolved = resolveUpstream({ provider: "openrouter", rung: "medium", env: {} })
    expect(resolved).toMatchObject({
      provider: "openrouter",
      chatCompletionsURL: "https://openrouter.ai/api/v1/chat/completions",
      model: DEFAULT_RUNG_MODELS.medium.modelID,
    })
  })
  test("resolves vercel rung fully", () => {
    const resolved = resolveUpstream({ provider: "vercel", rung: "cheapest", env: {} })
    expect(resolved?.provider).toBe("vercel")
    expect(resolved?.chatCompletionsURL).toBe("https://ai-gateway.vercel.sh/v1/chat/completions")
    expect(typeof resolved?.model).toBe("string")
  })
  test("custom needs base URL and a model id for the rung", () => {
    expect(resolveUpstream({ provider: "custom", rung: "cheapest", env: {} })).toBeUndefined()
    const noModel = resolveUpstream({
      provider: "custom",
      rung: "cheapest",
      customBaseURL: "https://llm.example.com/v1",
      env: {},
    })
    expect(noModel).toBeUndefined()
    const ok = resolveUpstream({
      provider: "custom",
      rung: "cheapest",
      customBaseURL: "https://llm.example.com/v1",
      customModels: { cheapest: "my-org/my-model" },
      env: {},
    })
    expect(ok).toMatchObject({
      provider: "custom",
      chatCompletionsURL: "https://llm.example.com/v1/chat/completions",
      model: "my-org/my-model",
    })
  })
})
