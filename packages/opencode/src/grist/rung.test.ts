import { describe, expect, test } from "bun:test"
import { PUBLIC_RUNG_NAME, publicModelRef, publicRungFor } from "./rung"
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
