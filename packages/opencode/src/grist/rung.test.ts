import { describe, expect, test } from "bun:test"
import { PUBLIC_RUNG_NAME, PUBLIC_RUNGS, publicModelRef, publicRungFor, RUNG_CONTEXT_FLOOR } from "./rung"
import { RUNG_MODELS } from "./gateway/ladder"

describe("RUNG_MODELS", () => {
  test("defaults to OpenRouter for every rung", () => {
    expect(RUNG_MODELS.cheapest.providerID).toBe("openrouter")
    expect(RUNG_MODELS.medium.providerID).toBe("openrouter")
    expect(RUNG_MODELS.frontier.providerID).toBe("openrouter")
    expect(RUNG_MODELS.cheapest.modelID).toBe("deepseek/deepseek-v4.1-flash")
    expect(RUNG_MODELS.medium.modelID).toBe("moonshotai/kimi-k3")
    expect(RUNG_MODELS.frontier.modelID).toBe("openai/gpt-6-sol")
    expect(RUNG_MODELS.premium.providerID).toBe("openrouter")
    expect(RUNG_MODELS.premium.modelID).toBe("anthropic/claude-opus-5.5")
  })

  test("public refs hide vendor ids", () => {
    expect(publicModelRef("cheapest")).toEqual({ providerID: "openrouter", modelID: "cheapest" })
    expect(publicModelRef("premium")).toEqual({ providerID: "openrouter", modelID: "premium" })
    expect(PUBLIC_RUNG_NAME.frontier).toBe("Max")
    expect(PUBLIC_RUNG_NAME.premium).toBe("Ultra")
  })
})

describe("B1 client safety", () => {
  test("provider.ts never imports gateway price/ladder tables", async () => {
    const source = await Bun.file(new URL("../provider/provider.ts", import.meta.url)).text()
    expect(source).not.toContain("gateway/prices")
    expect(source).not.toContain("gateway/ladder")
  })

  test("rung.ts ships numbers, not upstream identities", async () => {
    const source = await Bun.file(new URL("./rung.ts", import.meta.url)).text()
    // Doc comments may name the gateway module; the binary must not import it.
    expect(source).not.toMatch(/import\s+.*["']\.\/gateway\/ladder["']/)
    expect(source).not.toContain("deepseek/")
    expect(source).not.toContain("moonshotai/")
    expect(source).not.toContain("anthropic/")
  })

  test("publicRungFor maps only public rung names", () => {
    expect(publicRungFor("cheapest")).toBe("cheapest")
    expect(publicRungFor("medium")).toBe("medium")
    expect(publicRungFor("frontier")).toBe("frontier")
    expect(publicRungFor("premium")).toBe("premium")
    expect(publicRungFor("openrouter/cheapest")).toBe("cheapest")
    expect(publicRungFor("deepseek/deepseek-v4.1-flash")).toBeUndefined()
    expect(publicRungFor("anthropic/claude-opus-5.5")).toBeUndefined()
  })
})

describe("RUNG_CONTEXT_FLOOR", () => {
  test("every rung has a sane positive integer floor", () => {
    for (const rung of PUBLIC_RUNGS) {
      const floor = RUNG_CONTEXT_FLOOR[rung]
      expect(Number.isInteger(floor)).toBe(true)
      // 32k floor minimum: far above any degenerate template limit, safely
      // below every ladder model's real context window.
      expect(floor).toBeGreaterThanOrEqual(32_768)
    }
  })
})
