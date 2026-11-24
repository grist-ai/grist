import fs from "node:fs/promises"
import net from "node:net"
import { Effect } from "effect"
import { hostAllowed } from "./sandbox-policy.js"

/**
 * The driver's filtering egress proxy (Linux backend). A jailed process
 * has no network route at all; its only path out is a forwarder on its
 * loopback that connects here, over a unix socket in the environment's
 * scratch dir. This server speaks just enough HTTP proxy to enforce the
 * policy: CONNECT tunnels and absolute-form requests, admitted only when
 * the target host is on the allowlist. Everything else is refused without
 * touching the network.
 *
 * When the host machine itself sits behind an HTTP proxy (the ambient
 * HTTPS_PROXY/http_proxy of the server process), admitted traffic chains
 * through it — the allowlist check always happens here first, on the
 * target host the jailed process actually asked for.
 */

interface Upstream {
  readonly host: string
  readonly port: number
}

const upstreamOf = (sourceEnv: NodeJS.ProcessEnv): Upstream | undefined => {
  const value = sourceEnv.https_proxy ?? sourceEnv.HTTPS_PROXY ?? sourceEnv.http_proxy ?? sourceEnv.HTTP_PROXY
  if (!value) return undefined
  try {
    const url = new URL(value)
    return { host: url.hostname, port: Number.parseInt(url.port, 10) || 80 }
  } catch {
    return undefined
  }
}

const started = new Map<string, Promise<void>>()

export const ensureProxy = (input: {
  readonly socketPath: string
  readonly allowlist: ReadonlyArray<string>
  readonly sourceEnv: NodeJS.ProcessEnv
}): Effect.Effect<void, Error> => {
  const existing = started.get(input.socketPath)
  if (existing) return Effect.tryPromise(() => existing)
  const promise = start(input).catch((error: unknown) => {
    started.delete(input.socketPath)
    throw error
  })
  started.set(input.socketPath, promise)
  return Effect.tryPromise(() => promise)
}

const start = async (input: {
  readonly socketPath: string
  readonly allowlist: ReadonlyArray<string>
  readonly sourceEnv: NodeJS.ProcessEnv
}): Promise<void> => {
  const upstream = upstreamOf(input.sourceEnv)
  const server = net.createServer((client) => handle(client, input.allowlist, upstream))
  server.on("error", () => undefined)
  const listen = () =>
    new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening)
        reject(error)
      }
      const onListening = () => {
        server.off("error", onError)
        resolve()
      }
      server.once("error", onError)
      server.once("listening", onListening)
      server.listen(input.socketPath)
    })
  try {
    await listen()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error
    // A live proxy from another driver instance owns the socket: reuse it.
    if (await reachable(input.socketPath)) return
    // A stale socket file from a dead process: take it over.
    await fs.rm(input.socketPath, { force: true })
    await listen()
  }
  server.unref()
}

const reachable = (socketPath: string): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = net.connect(socketPath)
    probe.once("connect", () => {
      probe.destroy()
      resolve(true)
    })
    probe.once("error", () => resolve(false))
  })

const HEADER_LIMIT = 16 * 1024
const IDLE_TIMEOUT_MS = 120_000

const handle = (client: net.Socket, allowlist: ReadonlyArray<string>, upstream: Upstream | undefined): void => {
  client.setTimeout(IDLE_TIMEOUT_MS, () => client.destroy())
  let buffer = Buffer.alloc(0)
  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    const end = buffer.indexOf("\r\n\r\n")
    if (end < 0) {
      if (buffer.length > HEADER_LIMIT) client.destroy()
      return
    }
    client.off("data", onData)
    const head = buffer.subarray(0, end).toString("latin1")
    const rest = buffer.subarray(end + 4)
    const requestLine = head.split("\r\n")[0] ?? ""
    const [method, target] = requestLine.split(" ")
    if (method === "CONNECT" && target) return connect(client, target, rest, allowlist, upstream)
    if (target?.startsWith("http://")) return forward(client, head, rest, allowlist, upstream)
    client.end("HTTP/1.1 400 Bad Request\r\n\r\n")
  }
  client.on("data", onData)
  client.on("error", () => client.destroy())
}

const refuse = (client: net.Socket): void => {
  client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
}

/** Loopback is definitionally local: it is never chained through an ambient upstream proxy (which would resolve it from the wrong machine). */
const isLoopback = (host: string) => host === "localhost" || host === "::1" || host.startsWith("127.")

const upstreamFor = (upstream: Upstream | undefined, host: string) => (isLoopback(host) ? undefined : upstream)

const connect = (
  client: net.Socket,
  authority: string,
  rest: Buffer,
  allowlist: ReadonlyArray<string>,
  upstream: Upstream | undefined,
): void => {
  const [host, rawPort] = authority.split(":")
  const port = Number.parseInt(rawPort ?? "", 10) || 443
  if (!host || !hostAllowed(allowlist, host)) return refuse(client)
  const effectiveUpstream = upstreamFor(upstream, host)
  const open = (remote: net.Socket) => {
    remote.setTimeout(IDLE_TIMEOUT_MS, () => remote.destroy())
    remote.on("error", () => {
      remote.destroy()
      client.destroy()
    })
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    if (rest.length > 0) remote.write(rest)
    client.pipe(remote)
    remote.pipe(client)
  }
  if (!effectiveUpstream) {
    const remote = net.connect(port, host)
    remote.once("connect", () => open(remote))
    remote.once("error", () => client.destroy())
    return
  }
  const remote = net.connect(effectiveUpstream.port, effectiveUpstream.host)
  let greeted = Buffer.alloc(0)
  const onData = (chunk: Buffer) => {
    greeted = Buffer.concat([greeted, chunk])
    const end = greeted.indexOf("\r\n\r\n")
    if (end < 0) return
    remote.off("data", onData)
    const status = greeted.subarray(0, greeted.indexOf("\r\n")).toString("latin1")
    if (!status.includes(" 200")) {
      remote.destroy()
      client.destroy()
      return
    }
    const leftover = greeted.subarray(end + 4)
    open(remote)
    if (leftover.length > 0) client.write(leftover)
  }
  remote.on("data", onData)
  remote.once("connect", () => {
    remote.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`)
  })
  remote.once("error", () => client.destroy())
}

const forward = (
  client: net.Socket,
  head: string,
  rest: Buffer,
  allowlist: ReadonlyArray<string>,
  upstream: Upstream | undefined,
): void => {
  const requestLine = head.split("\r\n")[0] ?? ""
  const [method, target, version] = requestLine.split(" ")
  const url = new URL(target!)
  if (!hostAllowed(allowlist, url.hostname)) return refuse(client)
  const port = Number.parseInt(url.port, 10) || 80
  const effectiveUpstream = upstreamFor(upstream, url.hostname)
  const remote = effectiveUpstream ? net.connect(effectiveUpstream.port, effectiveUpstream.host) : net.connect(port, url.hostname)
  remote.setTimeout(IDLE_TIMEOUT_MS, () => remote.destroy())
  remote.once("error", () => client.destroy())
  remote.once("connect", () => {
    if (effectiveUpstream) {
      remote.write(`${head}\r\n\r\n`)
    } else {
      const headers = head.split("\r\n").slice(1).join("\r\n")
      remote.write(`${method} ${url.pathname}${url.search} ${version}\r\n${headers}\r\n\r\n`)
    }
    if (rest.length > 0) remote.write(rest)
    client.pipe(remote)
    remote.pipe(client)
  })
}

export * as SandboxProxy from "./sandbox-proxy.js"
