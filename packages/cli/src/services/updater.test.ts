import { describe, expect, test } from "bun:test"
import { action, compareRelease } from "./updater-action"
import { decodePolicy } from "./updater"

describe("updater", () => {
  test("reads update policy from JSONC", () => {
    expect(decodePolicy('{ // preference\n "update": "notify",\n}')).toBe("notify")
    expect(decodePolicy('{ "update": "disable" }')).toBe("disable")
    expect(decodePolicy('{ "update": "auto" }')).toBe("auto")
    expect(decodePolicy('{ "update": "invalid" }')).toBeUndefined()
  })

  test("maps the v1 update policy", () => {
    expect(decodePolicy('{ "autoupdate": false }')).toBe("disable")
    expect(decodePolicy('{ "autoupdate": "notify" }')).toBe("notify")
    expect(decodePolicy('{ "autoupdate": true }')).toBe("auto")
  })

  test("reports every available release", () => {
    expect(action("1.2.3", "1.2.4", "notify")).toBe("notify")
    expect(action("1.2.3", "1.3.0", "notify")).toBe("notify")
    expect(action("1.2.3", "2.0.0", "notify")).toBe("notify")
    expect(action("1.2.3", "1.2.3", "notify")).toBe("none")
  })

  test("automatically installs every available release when enabled", () => {
    expect(action("1.2.3", "1.2.4", "auto")).toBe("auto")
    expect(action("1.2.3", "1.2.3", "auto")).toBe("none")
  })

  test("skips when updates are disabled", () => {
    expect(action("1.2.3", "1.2.4", "disable")).toBe("none")
  })

  test("reports up-to-date only when versions match", () => {
    expect(action("1.2.3", "1.2.3", "notify")).toBe("none")
  })

  test("never reports an older release as an update", () => {
    expect(action("1.2.4", "1.2.3", "notify")).toBe("none")
    expect(action("2.0.18", "0.1.9", "notify")).toBe("none")
    expect(action("1.2.3", "1.2.3", "notify")).toBe("none")
  })

  test("accepts strict release version variants", () => {
    expect(action("v1.2.3", " 1.2.4\n", "notify")).toBe("notify")
    expect(action("1.2.3-alpha.1", "1.2.3-alpha.2", "notify")).toBe("notify")
    expect(action("0.0.0-dev-17403", "0.0.0-dev-17403.2", "notify")).toBe("notify")
    expect(action("0.0.0-beta-17404", "0.0.0-next-17403", "notify")).toBe("notify")
    expect(action("0.0.0-next-17403", "0.0.0-beta-17404", "notify")).toBe("none")
    expect(action("1.2.3+old", "1.2.3+new", "notify")).toBe("none")
    expect(action("v1.2.3+old", "1.2.3", "notify")).toBe("none")
  })

  test("preserves strict validity", () => {
    const invalid = [
      "=1.2.3",
      "V1.2.3",
      "1.2",
      "1.2.3.4",
      "01.2.3",
      "1.02.3",
      "1.2.03",
      "1.2.3-01",
      "1.2.3-",
      "1.2.3+",
      "1.2.3-alpha..1",
      "1.2.3_alpha",
      "9007199254740992.0.0",
      "0.9007199254740992.0",
      "0.0.9007199254740992",
    ]
    invalid.forEach((version) => expect(action("1.2.3", version, "notify"), version).toBe("none"))
  })

  test("handles numeric limits without losing precision", () => {
    expect(action("9007199254740991.0.0", "9007199254740991.0.1", "notify")).toBe("notify")
    expect(action("9007199254740990.0.0", "9007199254740991.0.0", "notify")).toBe("notify")
  })

  test("orders oversized numeric prerelease identifiers without precision loss", () => {
    expect(action("1.0.0-9007199254740992", "1.0.0-9007199254740993", "notify")).toBe("notify")
    expect(action("1.0.0-9007199254740993", "1.0.0-9007199254740992", "notify")).toBe("none")
    expect(action("1.0.0-9007199254740991", "1.0.0-9007199254740992", "notify")).toBe("notify")
  })

  test("rejects versions longer than semver's limit before trimming", () => {
    expect(action("1.2.3", `${" ".repeat(251)}1.2.3`, "notify")).toBe("none")
    expect(action("1.2.3", `1.2.4+${"a".repeat(250)}`, "notify")).toBe("notify")
  })

  test("compareRelease orders versions", () => {
    expect(compareRelease("1.2.3", "1.2.4")).toBeGreaterThan(0)
    expect(compareRelease("1.2.4", "1.2.3")).toBeLessThan(0)
    expect(compareRelease("1.2.3", "1.2.3")).toBe(0)
    expect(compareRelease("1.2.3-alpha", "1.2.3")).toBeGreaterThan(0)
    expect(compareRelease("1.2.3", "1.2.3-alpha")).toBeLessThan(0)
    expect(compareRelease("1.2.3-alpha.1", "1.2.3-alpha.2")).toBeGreaterThan(0)
    expect(compareRelease("2.0.18", "0.1.9")).toBeLessThan(0)
    expect(compareRelease("1.2.3", "not-a-version")).toBeUndefined()
  })
})
