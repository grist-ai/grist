import { describe, expect, test } from "bun:test"
import { askSystemOne, JEV_ENDPOINT, JEV_MODEL } from "./jev-client"
import { JEV_ENDPOINTS, JEV_MODELS, resolveJevRoute, resolveProviderKey } from "./jev-route"

const OPENROUTER = "sk-or-v1-test"
const VERCEL = "vck_test"
const TYPESAFE = "ts-test"

describe("resolveProviderKey", () => {
  test("maps each provider to its env var and ignores blanks", () => {
    const env = {
      OPENROUTER_API_KEY: ` ${OPENROUTER} `,
      AI_GATEWAY_API_KEY: VERCEL,
      TYPESAFE_API_KEY: "  ",
    }
    expect(resolveProviderKey("openrouter", env)).toBe(OPENROUTER)
    expect(resolveProviderKey("vercel", env)).toBe(VERCEL)
    expect(resolveProviderKey("typesafe", env)).toBeUndefined()
  })
})

describe("resolveJevRoute", () => {
  test("openrouter maps to systemone + typesafe/jev-latest", () => {
    const route = resolveJevRoute({ provider: "openrouter", env: { OPENROUTER_API_KEY: OPENROUTER } })
    expect(route).toEqual({
      provider: "openrouter",
      endpoint: "https://openrouter.ai/api/v1/systemone",
      model: "typesafe/jev-latest",
      apiKey: OPENROUTER,
    })
    expect(route?.endpoint).toBe(JEV_ENDPOINTS.openrouter)
    expect(route?.model).toBe(JEV_MODELS.openrouter)
  })

  test("vercel maps to the documented TypeSafe-compatible systemone path", () => {
    const route = resolveJevRoute({ provider: "vercel", env: { AI_GATEWAY_API_KEY: VERCEL } })
    expect(route).toEqual({
      provider: "vercel",
      endpoint: "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
      model: "typesafe-ai/jev",
      apiKey: VERCEL,
    })
  })

  test("typesafe maps to the current direct endpoint + jev-latest", () => {
    const route = resolveJevRoute({ provider: "typesafe", env: { TYPESAFE_API_KEY: TYPESAFE } })
    expect(route).toEqual({
      provider: "typesafe",
      endpoint: "https://api.typesafe.ai/v1/systemone",
      model: "jev-latest",
      apiKey: TYPESAFE,
    })
  })

  test("direct path is unchanged when only TYPESAFE_API_KEY is set", () => {
    const route = resolveJevRoute({ env: { TYPESAFE_API_KEY: TYPESAFE } })
    expect(route?.provider).toBe("typesafe")
    expect(route?.endpoint).toBe("https://api.typesafe.ai/v1/systemone")
    expect(route?.model).toBe("jev-latest")
    expect(route?.apiKey).toBe(TYPESAFE)
  })

  test("unspecified provider prefers the inference key over TypeSafe", () => {
    const openrouter = resolveJevRoute({
      env: { OPENROUTER_API_KEY: OPENROUTER, TYPESAFE_API_KEY: TYPESAFE },
    })
    expect(openrouter?.provider).toBe("openrouter")
    expect(openrouter?.model).toBe("typesafe/jev-latest")

    const vercel = resolveJevRoute({
      env: { AI_GATEWAY_API_KEY: VERCEL, TYPESAFE_API_KEY: TYPESAFE },
    })
    expect(vercel?.provider).toBe("vercel")

    const bothInference = resolveJevRoute({
      env: {
        OPENROUTER_API_KEY: OPENROUTER,
        AI_GATEWAY_API_KEY: VERCEL,
        TYPESAFE_API_KEY: TYPESAFE,
      },
    })
    expect(bothInference?.provider).toBe("openrouter")
  })

  test("explicit provider does not fall through to another key", () => {
    expect(
      resolveJevRoute({
        provider: "openrouter",
        env: { TYPESAFE_API_KEY: TYPESAFE },
      }),
    ).toBeUndefined()
  })

  test("resolveKey is the BYOK seam and is used instead of env", () => {
    const route = resolveJevRoute({
      provider: "openrouter",
      env: { OPENROUTER_API_KEY: "env-must-not-win" },
      resolveKey: (provider) => (provider === "openrouter" ? "byok-openrouter" : undefined),
    })
    expect(route?.apiKey).toBe("byok-openrouter")
    expect(route?.endpoint).toBe(JEV_ENDPOINTS.openrouter)
  })

  test("GRIST_JEV_PROVIDER pins the inference provider", () => {
    const route = resolveJevRoute({
      env: {
        GRIST_JEV_PROVIDER: "vercel",
        OPENROUTER_API_KEY: OPENROUTER,
        AI_GATEWAY_API_KEY: VERCEL,
        TYPESAFE_API_KEY: TYPESAFE,
      },
    })
    expect(route?.provider).toBe("vercel")
  })

  test("returns undefined when no provider key is present", () => {
    expect(resolveJevRoute({ env: {} })).toBeUndefined()
  })
})

describe("askSystemOne", () => {
  test("direct path posts jev-latest to the TypeSafe endpoint when only apiKey is passed", async () => {
    const calls: { url: string; model: string; authorization: string | null }[] = []
    const result = await askSystemOne({
      apiKey: TYPESAFE,
      state: { task: "rename helper" },
      questions: { ok: { type: "noul", instructions: "Is this scoped?", criteria: { true: "yes", false: "no" } } },
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { model: string }
        calls.push({
          url,
          model: body.model,
          authorization: new Headers(init?.headers).get("Authorization"),
        })
        return new Response(JSON.stringify({ model: JEV_MODEL, answers: { ok: { type: "noul", noul: 0.1 } } }), {
          status: 200,
        })
      },
    })
    expect(calls).toEqual([{ url: JEV_ENDPOINT, model: "jev-latest", authorization: `Bearer ${TYPESAFE}` }])
    expect(result.answers.ok).toEqual({ type: "noul", noul: 0.1 })
  })
})
