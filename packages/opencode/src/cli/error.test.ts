import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { FormatError } from "./error"

function capError() {
  return new APICallError({
    message: "Payment Required",
    url: "https://grist.lol/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 402,
    responseBody: JSON.stringify({
      error: "Spend cap reached ($5.00 of $5.00 used).",
      code: "spend_cap",
      remedy: "dashboard",
    }),
    responseHeaders: {},
  })
}

describe("FormatError", () => {
  test("gateway 402 spend cap surfaces cleanly", () => {
    const formatted = FormatError(capError())
    expect(formatted).toContain("Spend cap reached ($5.00 of $5.00 used).")
    expect(formatted).not.toContain("APICallError")
  })

  test("non-cap errors are untouched", () => {
    expect(FormatError(new Error("plain boom"))).toBeUndefined()
  })
})
