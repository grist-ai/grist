import { expect, test } from "bun:test"
import { popularProviders } from "./order"

test("lists the Grist gateway first among popular providers", () => {
  expect(popularProviders[0]).toBe("grist")
  expect(popularProviders).not.toContain("opencode")
  expect(popularProviders).not.toContain("opencode-go")
})
