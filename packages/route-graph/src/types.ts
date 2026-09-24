// Types for the route-graph extractor: Express route registrations found in
// TypeScript/JavaScript sources, before they are merged into a graph.json.

export type HandlerRef =
  | { kind: "member"; object: string; name: string; text: string }
  | { kind: "identifier"; name: string; text: string }
  | { kind: "inline"; text: string }
  | { kind: "expression"; text: string }

export interface RouteRegistration {
  // HTTP verb in lower case ("get", "post", ...) or "use" for middleware mounts.
  method: string
  // Resolved route path, e.g. "/channels/:channelId/messages".
  path: string
  // Raw source text of the path argument.
  pathRaw: string
  // False when the path came from an expression we could not resolve statically.
  pathResolved: boolean
  handlers: HandlerRef[]
  // For app.use("/api", router): the mounted router's local identifier, if the
  // single handler argument looks like a router reference.
  mounts?: string
  // Repo-relative path of the file containing the registration.
  file: string
  // 1-based line number of the registration call.
  line: number
  // True when the receiver identifier is provably an express Router/app
  // (assigned from express.Router()/express() in this file, or imported).
  onKnownRouter: boolean
}
