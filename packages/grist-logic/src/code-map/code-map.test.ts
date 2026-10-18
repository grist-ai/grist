import { describe, expect, test } from "bun:test"
import path from "path"
import { fileURLToPath } from "url"
import { scoreRetrieval } from "./bakeoff"
import { createGraphifyProvider } from "./graphify-provider"
import { loadGraphifyDocument, resolveSeeds, walkSubgraph } from "./graphify.js"
import { estimateTokens, formatSubgraph } from "./minimize.js"
import fixture from "./fixtures/mini-graph.json"

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mini-graph.json")

describe("code-map graphify", () => {
  const graph = loadGraphifyDocument(fixture)

  test("loads nodes and undirected adjacency", () => {
    expect(graph.nodes.size).toBe(7)
    expect(graph.edges.length).toBe(6)
    expect(graph.adj.get("fn:login")?.has("fn:verifyToken")).toBe(true)
    expect(graph.adj.get("fn:verifyToken")?.has("fn:login")).toBe(true)
  })

  test("resolveSeeds matches label and file", () => {
    expect(resolveSeeds(graph, "fn:login")).toEqual(["fn:login"])
    expect(resolveSeeds(graph, "login")[0]).toBe("fn:login")
    expect(resolveSeeds(graph, "auth.ts").length).toBeGreaterThan(0)
  })

  test("walkSubgraph stays within hop budget", () => {
    const sub = walkSubgraph(graph, { seed: "login", hops: 1 })
    expect(sub).toBeDefined()
    expect(sub!.nodes.some((n) => n.id === "fn:login")).toBe(true)
    expect(sub!.nodes.some((n) => n.id === "fn:createSession")).toBe(true)
    // query is 2 hops from login — not in 1-hop set
    expect(sub!.nodes.some((n) => n.id === "fn:query")).toBe(false)
  })

  test("formatSubgraph includes marker and respects budget", () => {
    const sub = walkSubgraph(graph, { seed: "login", hops: 2 })!
    const text = formatSubgraph(sub)
    expect(text).toContain("[grist:code-map]")
    expect(text).toContain("## Nodes")
    expect(estimateTokens(text)).toBeGreaterThan(0)
    const tiny = formatSubgraph(sub, 80)
    expect(tiny.length).toBeLessThanOrEqual(120)
    expect(tiny).toContain("truncated")
  })
})

describe("code-map bake-off scoring", () => {
  test("scores retrieval hit rate against expect needles", async () => {
    const provider = createGraphifyProvider({ graphPath: fixturePath })
    const status = await provider.status()
    expect(status.available).toBe(true)

    const result = await scoreRetrieval(provider, {
      id: "login-blast",
      query: "login",
      expect: ["createSession", "verifyToken"],
      hops: 1,
    })
    expect(result.hitRate).toBe(1)
    expect(result.nodeCount).toBeGreaterThan(0)
    expect(result.promptTokensEst).toBeGreaterThan(0)
  })

  test("misses when expect outside subgraph", async () => {
    const provider = createGraphifyProvider({ graphPath: fixturePath })
    const result = await scoreRetrieval(provider, {
      id: "login-db",
      query: "login",
      expect: ["fn:query"],
      hops: 1,
    })
    expect(result.hitRate).toBe(0)
    expect(result.misses).toContain("fn:query")
  })
})

describe("rankContextNodes", () => {
  test("orders by graph degree (blast radius), stable on ties", async () => {
    const { loadGraphifyDocument, rankContextNodes } = await import("./graphify.js")
    const doc = (await import("./fixtures/mini-graph.json")).default
    const graph = loadGraphifyDocument(doc as never)
    // degrees: fn:login=3, fn:createSession=3, fn:query=2, fn:verifyToken=1
    const ranked = rankContextNodes(graph, ["fn:verifyToken", "fn:query", "fn:login", "fn:createSession"])
    expect(ranked[0]).toBe("fn:login")
    expect(ranked.indexOf("fn:createSession")).toBeLessThan(ranked.indexOf("fn:query"))
    expect(ranked[ranked.length - 1]).toBe("fn:verifyToken")
  })
})
