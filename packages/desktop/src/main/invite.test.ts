import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { accountStatus, loadInviteConfig, logout, startLogin, waitLogin } from "./invite"

const files: string[] = []

function tempConfig() {
  const file = path.join(os.tmpdir(), `grist-desktop-invite-${crypto.randomUUID()}.json`)
  files.push(file)
  process.env.GRIST_CONFIG_PATH = file
  delete process.env.GRIST_INVITE
  delete process.env.GRIST_GATEWAY_URL
  return file
}

afterEach(() => {
  delete process.env.GRIST_CONFIG_PATH
  delete process.env.GRIST_INVITE
  delete process.env.GRIST_GATEWAY_URL
  for (const file of files.splice(0)) fs.rmSync(file, { force: true })
})

describe("desktop invite login", () => {
  test("reports signed-out until a device login is approved", async () => {
    tempConfig()
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/v1/auth/device" && req.method === "POST") {
          return Response.json({
            device_code: "device-1",
            user_code: "ABCD-2345",
            verification_uri: "/login?device=ABCD-2345",
            interval: 0,
            expires_in: 30,
          })
        }
        if (url.pathname === "/v1/auth/device/poll" && req.method === "POST") {
          return Response.json({ status: "approved", code: "grist-ABCD-2345" })
        }
        return new Response("no", { status: 404 })
      },
    })
    process.env.GRIST_GATEWAY_URL = `http://127.0.0.1:${server.port}`

    expect(accountStatus().signedIn).toBe(false)
    const opened: string[] = []
    const start = await startLogin((url) => opened.push(url))
    expect(start.userCode).toBe("ABCD-2345")
    expect(opened).toEqual([`${process.env.GRIST_GATEWAY_URL}/login?device=ABCD-2345`])

    const result = await waitLogin()
    expect(result).toEqual({ ok: true })
    expect(loadInviteConfig()).toEqual({
      code: "grist-ABCD-2345",
      gatewayUrl: process.env.GRIST_GATEWAY_URL,
    })
    expect(accountStatus().signedIn).toBe(true)

    logout()
    expect(accountStatus().signedIn).toBe(false)
    server.stop(true)
  })
})
