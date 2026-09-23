import { expect, mock, test } from "bun:test"
import { runLocalHeadless } from "@/cli/cmd/run/headless"

type DisposeOptions = { swallowErrors?: boolean }

// Records disposal only when AppRuntime actually runs the effect. Calling
// disposeAllInstancesAndEmitGlobalDisposed for real would tear down every
// instance in this process.
const disposed: Array<DisposeOptions | undefined> = []

mock.module("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: (config: { directory?: string }) => ({ directory: config.directory }),
}))

mock.module("@/server/global-lifecycle", () => ({
  disposeAllInstancesAndEmitGlobalDisposed: (options?: DisposeOptions) => options,
}))

mock.module("@/effect/app-runtime", () => ({
  AppRuntime: {
    runPromise(effect: DisposeOptions | undefined) {
      disposed.push(effect)
      return Promise.resolve()
    },
  },
}))

test("headless run disposes server instances after execute completes", async () => {
  disposed.length = 0
  let ran = false
  await runLocalHeadless({
    execute: async () => {
      ran = true
    },
  })
  expect(ran).toBe(true)
  expect(disposed).toEqual([{ swallowErrors: true }])
})

test("headless run disposes server instances when execute throws", async () => {
  disposed.length = 0
  await expect(
    runLocalHeadless({
      execute: async () => {
        throw new Error("run failed")
      },
    }),
  ).rejects.toThrow("run failed")
  expect(disposed).toEqual([{ swallowErrors: true }])
})

test("attach returns before the local headless run", async () => {
  const source = await Bun.file(new URL("../../../src/cli/cmd/run.ts", import.meta.url)).text()
  const attach = source.lastIndexOf("return await execute(sdk)")
  const headless = source.indexOf("await runLocalHeadless(")
  expect(attach).toBeGreaterThan(-1)
  expect(headless).toBeGreaterThan(attach)
})
