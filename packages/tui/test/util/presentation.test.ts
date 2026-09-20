import { expect, test } from "bun:test"
import { sessionEpilogue } from "../../src/util/presentation"

test("formats session continuation summary", () => {
  const epilogue = sessionEpilogue({ title: "A session", sessionID: "ses_123" })
  expect(epilogue).toContain("A session")
  expect(epilogue).toContain("grist -s ses_123")
})

test("epilogue wordmark is grist resume, not opencode", () => {
  const epilogue = sessionEpilogue({ title: "A session", sessionID: "ses_123" })
  const plain = epilogue.replace(/\x1b\[[0-9;]*m/g, "")
  expect(plain).toContain("grist -s ses_123")
  expect(plain.toLowerCase()).not.toContain("opencode")
})
