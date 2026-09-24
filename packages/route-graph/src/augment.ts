// Merges route registrations into a Graphify graph.json as new nodes and
// links, so "what HTTP endpoint reaches this code?" becomes answerable by
// graph traversal. New edges use relation "handles_route" (route node ->
// handler node) and "mounts" (app/router -> mounted sub-router).

import path from "path"
import { readdir } from "node:fs/promises"
import { extractFile } from "./extract"
import type { HandlerRef, RouteRegistration } from "./types"

export const RELATION_HANDLES_ROUTE = "handles_route"
export const RELATION_MOUNTS = "mounts"

interface GraphNode {
  id: string
  label: string
  norm_label: string
  source_file: string
  source_location: string
  file_type: string
  _origin: string
  _callable?: boolean
  [key: string]: unknown
}

interface GraphLink {
  source: string
  target: string
  relation: string
  _origin: string
  confidence: string
  confidence_score: number
  context: string
  source_file: string
  source_location: string
  weight: number
}

interface Graph {
  nodes: GraphNode[]
  links: GraphLink[]
  [key: string]: unknown
}

export interface AugmentStats {
  registrations: number
  nodesAdded: number
  linksAdded: number
  resolved: number
  unresolved: number
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

// Mirrors Graphify's node id scheme: source path lowercased, non-alphanumerics
// collapsed to underscores (see api_server_src_routes_auth in graph.json).
function fileIdPart(sourceFile: string): string {
  return sourceFile
    .toLowerCase()
    .replace(/\.[a-z]+$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function routeNodeId(reg: RouteRegistration): string {
  const pathPart = reg.path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return `${fileIdPart(reg.file)}_${reg.method}_${pathPart}`
}

function routeNode(reg: RouteRegistration): GraphNode {
  const label = `${reg.method.toUpperCase()} ${reg.path}`
  return {
    id: routeNodeId(reg),
    label,
    norm_label: label.toLowerCase(),
    source_file: reg.file,
    source_location: `L${reg.line}`,
    file_type: "code",
    _origin: "route-graph",
    _callable: false,
  }
}

function link(
  source: string,
  target: string,
  relation: string,
  reg: RouteRegistration,
  resolved: boolean,
): GraphLink {
  return {
    source,
    target,
    relation,
    _origin: "route-graph",
    confidence: resolved ? "EXTRACTED" : "INFERRED",
    confidence_score: resolved ? 1.0 : 0.6,
    context: "route",
    source_file: reg.file,
    source_location: `L${reg.line}`,
    weight: 1.0,
  }
}

// --- handler -> graph node resolution --------------------------------------

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]

function resolveImport(fromFile: string, specifier: string, repoFiles: Set<string>): string | null {
  if (!specifier.startsWith(".")) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
  const candidates = [
    ...SOURCE_EXTENSIONS.map((ext) => base + ext),
    ...SOURCE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
    base,
  ]
  return candidates.find((c) => repoFiles.has(c)) ?? null
}

function nodesInFile(nodes: GraphNode[], file: string): GraphNode[] {
  return nodes.filter((n) => n.source_file === file)
}

// Exact normalized match in one file, falling back to a contains-match
// (Graphify method nodes look like ".sendMessage()").
function findInFile(nodes: GraphNode[], name: string, file: string): GraphNode | null {
  const want = norm(name)
  const inFile = nodesInFile(nodes, file)
  return inFile.find((n) => norm(n.norm_label) === want) ?? inFile.find((n) => norm(n.norm_label).includes(want)) ?? null
}

function syntheticHandlerNode(reg: RouteRegistration, handler: HandlerRef): GraphNode {
  const id = `${routeNodeId(reg)}__handler_${norm(handler.text).slice(0, 40)}`
  return {
    id,
    label: handler.text.slice(0, 80),
    norm_label: norm(handler.text).slice(0, 80),
    source_file: reg.file,
    source_location: `L${reg.line}`,
    file_type: "code",
    _origin: "route-graph",
    _callable: true,
  }
}

// --- main ------------------------------------------------------------------

export interface AugmentOptions {
  graphPath: string
  repoDir: string
  outPath?: string
  write?: boolean
  // File extensions to scan for route registrations.
  extensions?: string[]
}

export async function augmentGraph(opts: AugmentOptions): Promise<AugmentStats> {
  const extensions = opts.extensions ?? [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]
  const repoDir = opts.repoDir
  const repoFiles = new Set<string>()
  const sourceFiles: string[] = []

  const scan = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "graphify-out") continue
      const full = path.posix.join(dir, entry.name)
      if (entry.isDirectory()) {
        await scan(full)
        continue
      }
      const rel = path.posix.relative(repoDir, full)
      repoFiles.add(rel)
      if (extensions.some((ext) => rel.endsWith(ext))) sourceFiles.push(rel)
    }
  }
  await scan(repoDir)

  const graph = (await Bun.file(opts.graphPath).json()) as Graph
  const nodes = graph.nodes
  const nodeIds = new Set(nodes.map((n) => n.id))
  const stats: AugmentStats = { registrations: 0, nodesAdded: 0, linksAdded: 0, resolved: 0, unresolved: 0 }

  const addNode = (node: GraphNode) => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
    stats.nodesAdded++
  }
  const addLink = (l: GraphLink) => {
    graph.links.push(l)
    stats.linksAdded++
  }

  for (const rel of sourceFiles) {
    const source = await Bun.file(path.posix.join(repoDir, rel)).text()
    const { registrations: regs, imports } = await extractFile(source, rel)
    for (const reg of regs) {
      stats.registrations++
      const route = routeNode(reg)
      addNode(route)

      if (reg.method === "use" && reg.mounts) {
        const targetFile = imports.has(reg.mounts) ? resolveImport(rel, imports.get(reg.mounts)!, repoFiles) : null
        const routerNode = targetFile
          ? nodesInFile(nodes, targetFile).find((n) => norm(n.norm_label).includes("router"))
          : null
        if (routerNode) {
          addLink(link(route.id, routerNode.id, RELATION_MOUNTS, reg, true))
          stats.resolved++
        } else {
          const synthetic = syntheticHandlerNode(reg, { kind: "identifier", name: reg.mounts, text: reg.mounts })
          addNode(synthetic)
          addLink(link(route.id, synthetic.id, RELATION_MOUNTS, reg, false))
          stats.unresolved++
        }
        continue
      }

      for (const handler of reg.handlers) {
        const target = await resolveHandler(handler, reg, imports, repoFiles, nodes)
        if (!target) continue
        if (target.synthetic) addNode(target.node)
        addLink(link(route.id, target.node.id, RELATION_HANDLES_ROUTE, reg, target.resolved))
        if (target.resolved) stats.resolved++
        else stats.unresolved++
      }
    }
  }

  if (opts.write) {
    await Bun.write(opts.outPath ?? opts.graphPath, JSON.stringify(graph))
  }
  return stats
}

interface ResolvedTarget {
  node: GraphNode
  resolved: boolean
  synthetic: boolean
}

async function resolveHandler(
  handler: HandlerRef,
  reg: RouteRegistration,
  imports: Map<string, string>,
  repoFiles: Set<string>,
  nodes: GraphNode[],
): Promise<ResolvedTarget | null> {
  if (handler.kind === "inline" || handler.kind === "expression") {
    return { node: syntheticHandlerNode(reg, handler), resolved: false, synthetic: true }
  }
  const name = handler.name
  // Resolution order: for `obj.method` the object's import target wins (the
  // qualifier is meaningful); for bare identifiers the same file wins
  // (locally defined middleware). Then a global name fallback (INFERRED).
  const importedFrom =
    handler.kind === "member" && imports.has(handler.object)
      ? imports.get(handler.object)
      : handler.kind === "identifier" && imports.has(name)
        ? imports.get(name)
        : undefined
  const importedFile = importedFrom ? resolveImport(reg.file, importedFrom, repoFiles) : null
  const firstChoice = handler.kind === "member" ? importedFile : reg.file
  const secondChoice = handler.kind === "member" ? reg.file : importedFile
  for (const file of [firstChoice, secondChoice]) {
    const hit = file ? findInFile(nodes, name, file) : null
    if (hit) return { node: hit, resolved: true, synthetic: false }
  }
  const anywhere = nodes.find((n) => norm(n.norm_label) === norm(name))
  if (anywhere) return { node: anywhere, resolved: false, synthetic: false }
  return { node: syntheticHandlerNode(reg, handler), resolved: false, synthetic: true }
}
