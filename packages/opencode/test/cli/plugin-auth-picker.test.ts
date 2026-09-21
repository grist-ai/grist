import { test, expect, describe } from "bun:test"
import { resolvePluginProviders, loginProviderChoices, parseWellKnownAuth } from "../../src/cli/cmd/providers"
import type { Hooks } from "@opencode-ai/plugin"

function hookWithAuth(provider: string): Hooks {
  return {
    auth: {
      provider,
      methods: [],
    },
  }
}

function hookWithoutAuth(): Hooks {
  return {}
}

describe("resolvePluginProviders", () => {
  test("returns plugin providers not in models.dev", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("skips providers already in models.dev", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("anthropic")],
      existingProviders: { anthropic: {} },
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("deduplicates across plugins", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey"), hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("respects disabled_providers", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(["portkey"]),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("respects enabled_providers when provider is absent", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      enabled: new Set(["anthropic"]),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("includes provider when in enabled set", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      enabled: new Set(["portkey"]),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("resolves name from providerNames", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      providerNames: { portkey: "Portkey AI" },
    })
    expect(result).toEqual([{ id: "portkey", name: "Portkey AI" }])
  })

  test("falls back to id when no name configured", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("skips hooks without auth", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithoutAuth(), hookWithAuth("portkey"), hookWithoutAuth()],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("returns empty for no hooks", () => {
    const result = resolvePluginProviders({
      hooks: [],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([])
  })
})

describe("loginProviderChoices", () => {
  test("puts Grist first and marks it recommended", () => {
    const result = loginProviderChoices({
      providers: [
        { id: "openai", name: "OpenAI" },
        { id: "anthropic", name: "Anthropic" },
      ],
      pluginProviders: [{ id: "grist", name: "grist" }],
    })
    expect(result[0]).toEqual({ label: "Grist", value: "grist", hint: "recommended" })
    expect(result.map((x) => x.value)).toEqual(["grist", "openai", "anthropic"])
  })
})

describe("parseWellKnownAuth", () => {
  test("returns undefined for HTML or missing command so URL login cannot crash", () => {
    expect(parseWellKnownAuth(undefined)).toBeUndefined()
    expect(parseWellKnownAuth("<!doctype html>")).toBeUndefined()
    expect(parseWellKnownAuth({ auth: {} })).toBeUndefined()
    expect(parseWellKnownAuth({ auth: { command: "oops", env: "TOKEN" } })).toBeUndefined()
    expect(parseWellKnownAuth({ auth: { command: ["tool", "login"], env: "TOKEN" } })).toEqual({
      command: ["tool", "login"],
      env: "TOKEN",
    })
  })
})
