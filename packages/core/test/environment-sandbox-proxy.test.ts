import { afterAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { ensureProxy } from "../src/environment/sandbox-proxy"

/** A local target server: the only "internet" these tests are allowed to touch. */
const target = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/plain" })
  response.end(`TARGET-OK ${request.url}`)
})
await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve))
const targetPort = (target.address() as net.AddressInfo).port

const dir = mkdtempSync(path.join(os.tmpdir(), "opencode-sandbox-proxy-"))
const socketPath = path.join(dir, "proxy.sock")
// sourceEnv {} = no ambient upstream proxy: direct dialing, loopback only.
await Effect.runPromise(ensureProxy({ socketPath, allowlist: ["localhost"], sourceEnv: {} }))

afterAll(() => {
  target.close()
})

const request = (raw: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = net.connect(socketPath)
    const chunks: Array<Buffer> = []
    socket.on("connect", () => socket.write(raw))
    socket.on("data", (chunk) => chunks.push(chunk))
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    socket.on("error", reject)
    setTimeout(() => resolve(Buffer.concat(chunks).toString("utf8")), 5_000).unref()
  })

describe("SandboxProxy egress enforcement", () => {
  test("CONNECT to an allowlisted host tunnels to the target", async () => {
    const response = await request(
      `CONNECT localhost:${targetPort} HTTP/1.1\r\nHost: localhost:${targetPort}\r\n\r\nGET /via-connect HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
    )
    expect(response).toContain("200 Connection Established")
    expect(response).toContain("TARGET-OK /via-connect")
  })

  test("CONNECT to a non-allowlisted host is refused without any network access", async () => {
    const response = await request("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n")
    expect(response).toContain("403 Forbidden")
    expect(response).not.toContain("Connection Established")
  })

  test("absolute-form HTTP forwards to allowlisted hosts and refuses the rest", async () => {
    const ok = await request(`GET http://localhost:${targetPort}/via-proxy HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`)
    expect(ok).toContain("200")
    expect(ok).toContain("TARGET-OK /via-proxy")
    const refused = await request("GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n")
    expect(refused).toContain("403 Forbidden")
  })

  test("anything that is not CONNECT or absolute-form HTTP is a bad request", async () => {
    const response = await request("GET /origin-form HTTP/1.1\r\nHost: localhost\r\n\r\n")
    expect(response).toContain("400 Bad Request")
  })

  test("loopback destinations bypass a configured upstream proxy", async () => {
    // A dead upstream: if localhost were chained through it, this could not work.
    const chainedPath = path.join(dir, "proxy-chained.sock")
    await Effect.runPromise(
      ensureProxy({ socketPath: chainedPath, allowlist: ["localhost"], sourceEnv: { http_proxy: "http://127.0.0.1:1" } }),
    )
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(chainedPath)
      const chunks: Array<Buffer> = []
      socket.on("connect", () =>
        socket.write(
          `CONNECT localhost:${targetPort} HTTP/1.1\r\nHost: localhost:${targetPort}\r\n\r\nGET /direct HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
        ),
      )
      socket.on("data", (chunk) => chunks.push(chunk))
      socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
      socket.on("error", reject)
      setTimeout(() => resolve(Buffer.concat(chunks).toString("utf8")), 5_000).unref()
    })
    expect(response).toContain("TARGET-OK /direct")
  })
})
