import { expect, test } from "bun:test"
import { requiresStableMacInstaller, stableMacDownload } from "./migration"

test("uses the external stable installer only for macOS beta", () => {
  expect(requiresStableMacInstaller("darwin", "beta")).toBe(true)
  expect(requiresStableMacInstaller("darwin", "prod")).toBe(false)
  expect(requiresStableMacInstaller("win32", "beta")).toBe(false)
  expect(requiresStableMacInstaller("linux", "beta")).toBe(false)
})

test("selects the signed stable installer for the current Mac architecture", () => {
  const release = {
    tag_name: "0.1.11",
    assets: [
      { name: "grist-desktop-mac-arm64.dmg", browser_download_url: "https://files.test/Grist-arm64.dmg" },
      { name: "grist-desktop-mac-arm64.zip", browser_download_url: "https://files.test/Grist-arm64.zip" },
      { name: "grist-desktop-mac-x64.dmg", browser_download_url: "https://files.test/Grist-x64.dmg" },
    ],
  }

  expect(stableMacDownload(release, "arm64")).toEqual({
    version: "0.1.11",
    url: "https://files.test/Grist-arm64.dmg",
  })
  expect(stableMacDownload(release, "x64")).toEqual({
    version: "0.1.11",
    url: "https://files.test/Grist-x64.dmg",
  })
  expect(stableMacDownload(release, "ia32")).toBeUndefined()
  expect(stableMacDownload({ tag_name: "0.1.11", assets: [] }, "arm64")).toBeUndefined()
})
