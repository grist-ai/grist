import { describe, expect, test } from "bun:test"
import { compareVersions, describeInvite, formatChecklist, summarize, type CheckResult } from "./doctor"

const results = (statuses: CheckResult["status"][]): CheckResult[] =>
  statuses.map((status, i) => ({ name: `check-${i}`, status, detail: "detail" }))

describe("doctor", () => {
  test("compareVersions orders semver triples", () => {
    expect(compareVersions("0.1.7", "0.1.8")).toBe(-1)
    expect(compareVersions("0.1.8", "0.1.8")).toBe(0)
    expect(compareVersions("0.2.0", "0.1.8")).toBe(1)
    expect(compareVersions("v0.1.8", "0.1.8")).toBe(0)
    expect(compareVersions("0.1", "0.1.0")).toBe(0)
  })

  test("describeInvite never leaks the credential", () => {
    const signed = describeInvite({
      code: "grist_sk_super_secret_value",
      gatewayUrl: "https://grist.lol",
      kind: "api_key",
    })
    expect(signed.status).toBe("pass")
    expect(signed.detail).toContain("api key")
    expect(signed.detail).toContain("https://grist.lol")
    expect(signed.detail).not.toContain("grist_sk_super_secret_value")

    const invite = describeInvite({ code: "grist-AAAA-1111", gatewayUrl: "https://x", kind: "invite" })
    expect(invite.status).toBe("pass")
    expect(invite.detail).toContain("invite code")
    expect(invite.detail).not.toContain("grist-AAAA-1111")

    const missing = describeInvite(undefined)
    expect(missing.status).toBe("fail")
    expect(missing.detail).toContain("grist auth login")
  })

  test("summarize counts by status", () => {
    expect(summarize(results(["pass", "warn", "fail", "pass"]))).toEqual({ pass: 2, warn: 1, fail: 1 })
  })

  test("formatChecklist renders markers and a verdict", () => {
    const text = formatChecklist(results(["pass", "warn", "fail"]))
    expect(text).toContain("✓ check-0")
    expect(text).toContain("! check-1")
    expect(text).toContain("✗ check-2")
    expect(text).toContain("doctor found problems")
    const clean = formatChecklist(results(["pass", "pass"]))
    expect(clean).toContain("all checks passed")
  })
})
