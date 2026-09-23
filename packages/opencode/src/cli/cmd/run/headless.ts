import type { OpencodeClient } from "@opencode-ai/sdk/v2"

// Headless `grist run` talks to an in-process server. Dispose every instance
// after the prompt finishes so watchers, databases, and background fibers
// cannot keep the process alive.
export async function runLocalHeadless(input: {
  directory?: string
  execute: (sdk: OpencodeClient) => Promise<void>
}) {
  const { createOpencodeClient } = await import("@opencode-ai/sdk/v2")
  const fetchFn = (async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const { Server } = await import("@/server/server")
    const { ServerAuth } = await import("@/server/auth")
    const request = new Request(requestInput, init)
    const headers = new Headers(request.headers)
    const auth = ServerAuth.header()
    if (auth) headers.set("Authorization", auth)
    return Server.Default().app.fetch(new Request(request, { headers, signal: request.signal }))
  }) as typeof globalThis.fetch
  const sdk = createOpencodeClient({
    baseUrl: "http://opencode.internal",
    fetch: fetchFn,
    directory: input.directory,
  })
  try {
    await input.execute(sdk)
  } finally {
    const { AppRuntime } = await import("@/effect/app-runtime")
    const { disposeAllInstancesAndEmitGlobalDisposed } = await import("@/server/global-lifecycle")
    await AppRuntime.runPromise(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
  }
}
