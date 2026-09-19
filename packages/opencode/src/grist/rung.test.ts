import { describe, expect, test } from "bun:test"
import { RUNG_MODELS } from "./rung"

describe("RUNG_MODELS", () => {
  test("defaults to OpenRouter for every rung", () => {
    expect(RUNG_MODELS.cheapest.providerID).toBe("openrouter")
    expect(RUNG_MODELS.medium.providerID).toBe("openrouter")
    expect(RUNG_MODELS.frontier.providerID).toBe("openrouter")
    expect(RUNG_MODELS.cheapest.modelID).toContain("deepseek")
    expect(RUNG_MODELS.medium.modelID).toContain("deepseek")
    expect(RUNG_MODELS.frontier.modelID).toContain("anthropic/")
  })
})
