import { describe, expect, test } from "bun:test"
import { moonshinePthreadCopy, moonshinePthreadFallback } from "./pthread-assets"

describe("moonshine pthread assets", () => {
  test("copies hashed glue files to the names Emscripten workers request", () => {
    expect(
      moonshinePthreadCopy(["moonshine--7Zs2PVp.mjs", "moonshine-BVXNa59I.wasm", "main.js"]),
    ).toEqual([
      { from: "moonshine--7Zs2PVp.mjs", to: "moonshine.mjs" },
      { from: "moonshine-BVXNa59I.wasm", to: "moonshine.wasm" },
    ])
    expect(moonshinePthreadCopy(["moonshine-7Zs2PVp.mjs", "moonshine.wasm"])).toEqual([
      { from: "moonshine-7Zs2PVp.mjs", to: "moonshine.mjs" },
    ])
  })

  test("resolves an unhashed worker request to the hashed glue file", () => {
    const siblings = ["moonshine--hashed.mjs", "moonshine-hashed.wasm"]
    expect(moonshinePthreadFallback("moonshine.mjs", siblings)).toBe("moonshine--hashed.mjs")
    expect(moonshinePthreadFallback("moonshine.wasm", siblings)).toBe("moonshine-hashed.wasm")
    expect(moonshinePthreadFallback("main.js", siblings)).toBeUndefined()
  })
})
