import fs from "fs"
import path from "path"
import { createGateway } from "./http.js"

export async function listenGateway(input?: {
  hostname?: string
  port?: number
  dbPath?: string
}) {
  const hostname = input?.hostname ?? process.env.HOST ?? "0.0.0.0"
  const port = input?.port ?? Number(process.env.PORT ?? 8787)
  const dbPath = input?.dbPath ?? process.env.GRIST_GATEWAY_DB ?? "grist-gateway.sqlite"
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true })
  const gateway = createGateway({ dbPath })

  const server = Bun.serve({
    hostname,
    port,
    fetch: gateway.fetch,
  })
  console.log(`Grist gateway listening on http://${server.hostname}:${server.port}`)
  return server
}
