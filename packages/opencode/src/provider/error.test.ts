import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import { parseAPICallError } from "./error"

function capError(remedy: string) {
  return new APICallError({
    message: "Payment Required",
    url: "https://grist.lol/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 402,
    responseBody: JSON.stringify({
      error: "Spend cap reached ($5.00 of $5.00 used).",
      code: "spend_cap",
      remedy,
    }),
    responseHeaders: {},
  })
}

const providerID = "openrouter" as ProviderV2.ID

describe("parseAPICallError 402 spend caps", () => {
  test("BYOK remedy points at the dashboard, not the founder", () => {
    const parsed = parseAPICallError({ providerID, error: capError("dashboard") })
    expect(parsed.type).toBe("api_error")
    expect(parsed.message).toContain("Spend cap reached")
    expect(parsed.message).toContain("Grist dashboard")
    expect(parsed.message).not.toContain("founder")
    if (parsed.type === "api_error") expect(parsed.isRetryable).toBe(false)
  })

  test("house-key remedy still asks the founder", () => {
    const parsed = parseAPICallError({ providerID, error: capError("founder") })
    expect(parsed.message).toContain("Ask the founder")
  })
})
