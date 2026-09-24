// @grist/route-graph: Express route-registration extraction for Grist's
// Graphify-based code map. Finds `router.METHOD(path, ...handlers)` calls
// that AST graph extractors miss and merges them into graph.json as
// `handles_route` / `mounts` edges.

export { extractRoutes, extractFile } from "./extract"
export { augmentGraph, RELATION_HANDLES_ROUTE, RELATION_MOUNTS } from "./augment"
export type { ExtractedFile } from "./extract"
export type { AugmentOptions, AugmentStats } from "./augment"
export type { HandlerRef, RouteRegistration } from "./types"

async function main() {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const graphPath = flag("--graph")
  const repoDir = flag("--repo")
  if (!graphPath || !repoDir) {
    console.error("usage: bun src/index.ts --graph <graph.json> --repo <repoDir> [--out <path>] [--write]")
    process.exit(1)
  }
  const { augmentGraph } = await import("./augment")
  const stats = await augmentGraph({
    graphPath,
    repoDir,
    outPath: flag("--out"),
    write: args.includes("--write"),
  })
  console.log(JSON.stringify(stats))
}

if (import.meta.main) await main()
