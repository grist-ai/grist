import { describe, expect, test } from "bun:test"
import { RUNG_MODELS } from "./rung"

describe("RUNG_MODELS", () => {
  test("defaults to OpenRouter for every rung", () => {
    expect(RUNG_MODELS.cheapest.providerID).toBe("openrouter")
    expect(RUNG_MODELS.medium.providerID).toBe("openrouter")
    expect(RUNG_MODELS.frontier.providerID).toBe("openrouter")
    expect(RUNG_MODELS.cheapest.modelID).toBe("deepseek/deepseek-v4.1-flash")
    expect(RUNG_MODELS.medium.modelID).toBe("moonshotai/kimi-k3")
    expect(RUNG_MODELS.frontier.modelID).toBe("openai/gpt-5.6-sol")
  })
})
