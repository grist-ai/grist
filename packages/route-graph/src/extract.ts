// Extracts Express route registrations from TypeScript/JavaScript sources
// using tree-sitter. This closes the blind spot Graphify and CRG share:
// `router.post(path, handler)` produces no call/reference edge in either
// tool, so "what HTTP endpoint reaches this code?" is unanswerable from the
// graph alone.

import { Language, Parser } from "web-tree-sitter"
import { fileURLToPath } from "url"
import type { HandlerRef, RouteRegistration } from "./types"

const ROUTE_METHODS = new Set(["get", "post", "put", "delete", "patch", "all", "options", "head"])

// web-tree-sitter loads its core runtime from a WASM blob; the language
// grammar is a second WASM blob. Bun resolves `*.wasm` imports to file URLs.
let parserPromise: Promise<Parser> | null = null

function loadParser(): Promise<Parser> {
  if (parserPromise) return parserPromise
  parserPromise = (async () => {
    const { default: coreWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
      with: { type: "wasm" },
    })
    await Parser.init({
      locateFile: () => (coreWasm.startsWith("file://") ? fileURLToPath(coreWasm) : coreWasm),
    })
    const { default: tsWasm } = await import("tree-sitter-typescript/tree-sitter-typescript.wasm" as string, {
      with: { type: "wasm" },
    })
    const parser = new Parser()
    parser.setLanguage(await Language.load(tsWasm.startsWith("file://") ? fileURLToPath(tsWasm) : tsWasm))
    return parser
  })()
  return parserPromise
}

interface NamedNode {
  type: string
  text: string
  startPosition: { row: number; column: number }
  namedChildCount: number
  namedChild(i: number): NamedNode | null
  childForFieldName(name: string): NamedNode | null
}

function namedChildren(node: NamedNode): NamedNode[] {
  const out: NamedNode[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child) out.push(child)
  }
  return out
}

function* walk(node: NamedNode): Generator<NamedNode> {
  yield node
  for (const child of namedChildren(node)) yield* walk(child)
}

function nodeText(node: NamedNode): string {
  return node.text
}

// Local name -> module specifier for every import in the file, e.g.
// `import messageController from "../controllers/MessageController"` gives
// messageController -> ../controllers/MessageController.
function importMap(root: NamedNode): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of walk(root)) {
    if (node.type !== "import_statement") continue
    const specifier = namedChildren(node).find((c) => c.type === "string")
    if (!specifier) continue
    const from = specifier.text.slice(1, -1)
    const clause = namedChildren(node).find((c) => c.type === "import_clause")
    if (!clause) continue
    for (const part of namedChildren(clause)) {
      if (part.type === "identifier") map.set(part.text, from)
      if (part.type === "named_imports") {
        for (const spec of namedChildren(part)) {
          if (spec.type !== "import_specifier") continue
          const alias = spec.childForFieldName("alias")
          const name = spec.childForFieldName("name")
          map.set(alias ? alias.text : name ? name.text : spec.text, from)
        }
      }
    }
  }
  return map
}

// Identifier -> string literal for top-level `const NAME = "..."` so route
// paths held in constants can be resolved.
function constStrings(root: NamedNode): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of walk(root)) {
    if (node.type !== "variable_declarator") continue
    const name = node.childForFieldName("name")
    const value = node.childForFieldName("value")
    if (name && value && value.type === "string") map.set(name.text, value.text.slice(1, -1))
  }
  return map
}

// Identifiers provably holding an express Router or app instance:
// `const router = express.Router()`, `const app = express()`,
// `import router from "./router"`.
function knownRouters(root: NamedNode, imports: Map<string, string>): Set<string> {
  const known = new Set<string>()
  for (const node of walk(root)) {
    if (node.type !== "variable_declarator") continue
    const name = node.childForFieldName("name")
    const value = node.childForFieldName("value")
    if (!name || !value || value.type !== "call_expression") continue
    const fn = namedChildren(value)[0]
    if (fn?.type !== "member_expression") {
      // Bare Router() call (imported from express).
      if (fn?.type === "identifier" && fn.text === "Router") known.add(name.text)
      continue
    }
    const prop = namedChildren(fn).find((c) => c.type === "property_identifier")
    if (prop && (prop.text === "Router" || prop.text === "Application")) known.add(name.text)
  }
  for (const [local, from] of imports) {
    if (/(^|\/)router(\.|$)/i.test(from) || local.toLowerCase().includes("router")) known.add(local)
  }
  return known
}

function stripQuotes(text: string): string {
  return text.slice(1, -1)
}

function resolvePathArg(
  arg: NamedNode,
  constants: Map<string, string>,
): { path: string; pathRaw: string; pathResolved: boolean } {
  const pathRaw = nodeText(arg)
  if (arg.type === "string") return { path: stripQuotes(pathRaw), pathRaw, pathResolved: true }
  if (arg.type === "template_string") {
    if (!pathRaw.includes("${")) return { path: pathRaw.slice(1, -1), pathRaw, pathResolved: true }
    return { path: pathRaw, pathRaw, pathResolved: false }
  }
  if (arg.type === "identifier" && constants.has(arg.text)) {
    return { path: constants.get(arg.text)!, pathRaw, pathResolved: true }
  }
  return { path: pathRaw, pathRaw, pathResolved: false }
}

function classifyHandler(arg: NamedNode): HandlerRef {
  const text = nodeText(arg)
  if (arg.type === "member_expression") {
    const parts = namedChildren(arg)
    const object = parts.find((c) => c.type === "identifier")
    const name = parts.find((c) => c.type === "property_identifier")
    if (object && name) return { kind: "member", object: object.text, name: name.text, text }
  }
  if (arg.type === "identifier") return { kind: "identifier", name: arg.text, text }
  if (arg.type === "arrow_function" || arg.type === "function_expression" || arg.type === "function") {
    return { kind: "inline", text }
  }
  return { kind: "expression", text }
}

interface CallShape {
  receiver: string
  method: string
  methodCol: number
  args: NamedNode[]
  line: number
  // For `router.route("/p").get(h)` chains: the path-carrying inner call's args.
  routeCallArgs?: NamedNode[]
}

// Unpacks `router.route("/p")` when it appears anywhere in the receiver chain
// of a `.get(handler)` / `.post(handler)` call, e.g.
// `router.route("/p").get(a).put(b)`. Returns the .route() call's argument
// nodes plus the router identifier, or null when no .route() call is found.
function routeCallInner(node: NamedNode): { args: NamedNode[]; receiver: string } | null {
  let current: NamedNode | null = node.type === "call_expression" ? node : null
  while (current) {
    const fn = namedChildren(current)[0]
    if (fn?.type !== "member_expression") return null
    const parts = namedChildren(fn)
    const prop = parts.find((c) => c.type === "property_identifier")
    const object = parts.find((c) => c.type === "identifier" || c.type === "call_expression")
    if (prop?.text === "route" && object?.type === "identifier") {
      const argsNode = namedChildren(current).find((c) => c.type === "arguments")
      return { args: argsNode ? namedChildren(argsNode) : [], receiver: object.text }
    }
    current = object?.type === "call_expression" ? object : null
  }
  return null
}

function callShape(node: NamedNode): CallShape | null {
  const fn = namedChildren(node)[0]
  if (!fn || fn.type !== "member_expression") return null
  const parts = namedChildren(fn)
  const prop = parts.find((c) => c.type === "property_identifier")
  if (!prop || prop.text === "route") return null
  const argsNode = namedChildren(node).find((c) => c.type === "arguments")
  const args = argsNode ? namedChildren(argsNode) : []
  const line = node.startPosition.row + 1

  const object = parts.find((c) => c.type === "identifier")
  if (object)
    return { receiver: object.text, method: prop.text, methodCol: prop.startPosition.column, args, line }

  // `router.route("/p").get(handler)`: the receiver is the .route() call.
  const maybeCall = parts.find((c) => c.type === "call_expression")
  const inner = maybeCall ? routeCallInner(maybeCall) : null
  if (inner)
    return {
      receiver: inner.receiver,
      method: prop.text,
      methodCol: prop.startPosition.column,
      args,
      line,
      routeCallArgs: inner.args,
    }
  return null
}

function isRouteMethodCall(shape: CallShape, routers: Set<string>): boolean {
  if (shape.method === "use") return true
  if (!ROUTE_METHODS.has(shape.method)) return false
  if (routers.has(shape.receiver)) return true
  // Convention fallback: receivers literally named router/app.
  return shape.receiver === "router" || shape.receiver === "app"
}

export async function extractRoutes(source: string, file: string): Promise<RouteRegistration[]> {
  const { registrations } = await extractFile(source, file)
  return registrations
}

export interface ExtractedFile {
  registrations: RouteRegistration[]
  imports: Map<string, string>
}

export async function extractFile(source: string, file: string): Promise<ExtractedFile> {
  const parser = await loadParser()
  const tree = parser.parse(source)
  const root = tree!.rootNode as unknown as NamedNode
  const imports = importMap(root)
  const constants = constStrings(root)
  const routers = knownRouters(root, imports)
  const registrations: RouteRegistration[] = []
  // methodCol keeps chained `router.route("/p").get(a).put(b)` registrations in
  // source order (the AST walk visits the outer call first).
  const order: number[] = []

  for (const node of walk(root)) {
    if (node.type !== "call_expression") continue
    const shape = callShape(node)
    if (!shape || !isRouteMethodCall(shape, routers)) continue

    // `router.route("/p").get(h)`: path comes from the inner .route() call.
    // `app.use(mw)`: a non-string first argument is middleware, not a path.
    const rawPathArg = shape.routeCallArgs ? shape.routeCallArgs[0] : shape.args[0]
    const pathArg =
      shape.method === "use" && rawPathArg && !isPathLike(rawPathArg, constants) ? null : rawPathArg
    const { path, pathRaw, pathResolved } = pathArg
      ? resolvePathArg(pathArg, constants)
      : { path: "/", pathRaw: "", pathResolved: true }
    const handlerArgs = shape.routeCallArgs ? shape.args : pathArg ? shape.args.slice(1) : shape.args
    const handlers = handlerArgs.map(classifyHandler)

    const mounts =
      shape.method === "use" && handlers.length === 1 && handlers[0].kind === "identifier"
        ? (handlers[0].name as string)
        : undefined

    registrations.push({
      method: shape.method,
      path,
      pathRaw,
      pathResolved,
      handlers,
      mounts,
      file,
      line: shape.line,
      onKnownRouter: routers.has(shape.receiver),
    })
    order.push(shape.line * 100000 + shape.methodCol)
  }
  const sorted = registrations
    .map((reg, i) => ({ reg, at: order[i] }))
    .sort((a, b) => a.at - b.at)
    .map((r) => r.reg)
  return { registrations: sorted, imports }
}

// A `use()` first argument is a path only when it is a string literal,
// template literal, or a constant holding a string. Anything else
// (`app.use(cors())`, `app.use(authRouter)`) is middleware.
function isPathLike(arg: NamedNode, constants: Map<string, string>): boolean {
  return (
    arg.type === "string" || arg.type === "template_string" || (arg.type === "identifier" && constants.has(arg.text))
  )
}
