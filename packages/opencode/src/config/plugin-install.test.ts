import { describe, expect, test } from "bun:test"
import { PLUGIN_NPM_VERSION, pluginInstallAdd } from "./plugin-install"

describe("pluginInstallAdd", () => {
  test("pins a published @opencode-ai/plugin version, not grist-ai 0.1.x", () => {
    expect(PLUGIN_NPM_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(PLUGIN_NPM_VERSION.startsWith("0.")).toBe(false)
    expect(pluginInstallAdd.name).toBe("@opencode-ai/plugin")
  })
})
