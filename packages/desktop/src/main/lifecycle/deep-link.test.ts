import { describe, expect, test } from "bun:test"
import { PROTOCOL_SCHEME } from "../../../brand"
import { consoleReturnWindow } from "./deep-link"

describe("Console return deep links", () => {
  test("reads the originating Desktop window", () => {
    expect(consoleReturnWindow(`${PROTOCOL_SCHEME}://console/authorized?window=window-a`)).toBe("window-a")
    expect(consoleReturnWindow(`${PROTOCOL_SCHEME}://console/authorized?window=window%20b`)).toBe("window b")
  })

  test("rejects unrelated and malformed links", () => {
    expect(consoleReturnWindow(`${PROTOCOL_SCHEME}://console/other?window=window-a`)).toBeUndefined()
    expect(consoleReturnWindow(`${PROTOCOL_SCHEME}://other/authorized?window=window-a`)).toBeUndefined()
    expect(consoleReturnWindow("https://console/authorized?window=window-a")).toBeUndefined()
    expect(consoleReturnWindow("not a url")).toBeUndefined()
    expect(consoleReturnWindow(`${PROTOCOL_SCHEME}://console/authorized`)).toBeUndefined()
    expect(consoleReturnWindow("opencode://console/authorized?window=window-a")).toBeUndefined()
  })
})
