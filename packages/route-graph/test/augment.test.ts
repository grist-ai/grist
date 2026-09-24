import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "path"
import { augmentGraph, RELATION_HANDLES_ROUTE, RELATION_MOUNTS } from "../src/augment"

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "route-graph-"))
  await mkdir(path.join(dir, "routes"), { recursive: true })
  await mkdir(path.join(dir, "controllers"), { recursive: true })
  await Bun.write(
    path.join(dir, "controllers", "UserController.ts"),
    `export default class UserController {\n  async getUser(req, res) {}\n}\n`,
  )
  await Bun.write(
    path.join(dir, "routes", "users.ts"),
    `import express from 'express';\n` +
      `import userController from '../controllers/UserController';\n` +
      `const router = express.Router();\n` +
      `router.get('/users/:id', userController.getUser);\n` +
      `router.post('/users', userController.missing);\n`,
  )
  const graph = {
    directed: true,
    graph: {},
    nodes: [
      {
        id: "repo_controllers_usercontroller_usercontroller_getuser",
        label: ".getUser()",
        norm_label: ".getuser()",
        source_file: "controllers/UserController.ts",
        source_location: "L2",
        file_type: "code",
        _origin: "ast",
        _callable: true,
      },
    ],
    links: [],
    hyperedges: [],
  }
  const graphPath = path.join(dir, "graph.json")
  await Bun.write(graphPath, JSON.stringify(graph))
  return { dir, graphPath }
}

describe("augmentGraph", () => {
  test("adds route nodes and resolves handlers through imports", async () => {
    const { dir, graphPath } = await fixture()
    const outPath = path.join(dir, "graph.out.json")
    const stats = await augmentGraph({ graphPath, repoDir: dir, outPath, write: true })

    expect(stats.registrations).toBe(2)
    expect(stats.resolved).toBe(1)
    expect(stats.unresolved).toBe(1)

    const out = (await Bun.file(outPath).json()) as {
      nodes: { id: string; label: string }[]
      links: { source: string; target: string; relation: string; confidence: string }[]
    }
    const routeLinks = out.links.filter((l) => l.relation === RELATION_HANDLES_ROUTE)
    expect(routeLinks).toHaveLength(2)

    const resolved = routeLinks.find(
      (l) => l.target === "repo_controllers_usercontroller_usercontroller_getuser",
    )
    expect(resolved).toBeDefined()
    expect(resolved!.confidence).toBe("EXTRACTED")
    const routeNode = out.nodes.find((n) => n.id === resolved!.source)
    expect(routeNode!.label).toBe("GET /users/:id")

    // Reverse traversal answers "what endpoint reaches getUser?".
    const unresolved = routeLinks.find((l) => l.confidence === "INFERRED")
    expect(unresolved).toBeDefined()
    const synthetic = out.nodes.find((n) => n.id === unresolved!.target)
    expect(synthetic!.label).toContain("missing")
  })

  test("app.use emits mounts edges", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "route-graph-"))
    await Bun.write(path.join(dir, "server.ts"), `import userRouter from './userRouter';\napp.use('/api', userRouter);\n`)
    const graphPath = path.join(dir, "graph.json")
    await Bun.write(graphPath, JSON.stringify({ nodes: [], links: [] }))
    const outPath = path.join(dir, "graph.out.json")
    await augmentGraph({ graphPath, repoDir: dir, outPath, write: true })
    const out = (await Bun.file(outPath).json()) as {
      links: { relation: string }[]
    }
    expect(out.links.filter((l) => l.relation === RELATION_MOUNTS)).toHaveLength(1)
  })
})
