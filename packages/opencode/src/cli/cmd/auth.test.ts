import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { canPromptLogin, ensureSignedIn } from "./auth"
import { saveInviteConfig } from "@/grist/invite/config"

const files: string[] = []

afterEach(() => {
  for (const file of files.splice(0)) fs.rmSync(file, { force: true })
  delete process.env.GRIST_CONFIG_PATH
  delete process.env.GRIST_INVITE
  delete process.env.GRIST_GATEWAY_URL
})

describe("ensureSignedIn", () => {
  test("returns true when invite config already exists", async () => {
    const file = path.join(os.tmpdir(), `grist-auth-${crypto.randomUUID()}.json`)
    files.push(file)
    process.env.GRIST_CONFIG_PATH = file
    saveInviteConfig({ code: "grist-ABCD-2345", gatewayUrl: "http://127.0.0.1:8787" })
    expect(await ensureSignedIn()).toBe(true)
  })

  test("returns false without a saved invite when stdin is not a TTY", async () => {
    const file = path.join(os.tmpdir(), `grist-auth-${crypto.randomUUID()}.json`)
    files.push(file)
    process.env.GRIST_CONFIG_PATH = file
    const previous = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false })
    expect(canPromptLogin()).toBe(false)
    expect(await ensureSignedIn()).toBe(false)
    if (previous) Object.defineProperty(process.stdin, "isTTY", previous)
    else delete (process.stdin as { isTTY?: boolean }).isTTY
  })
})
