import { app, net, protocol } from "electron"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  coepHeader,
  coopHeader,
  documentPolicyHeader,
  embedderPolicy,
  isolationPolicy,
  jsCallStacksDocumentPolicy,
} from "./headers"
import { rendererHost, rendererProtocol } from "./scheme"
import { resolveSpeechAsset, speechResourceRoot, SPEECH_PROTOCOL } from "./speech-assets"

const root = path.dirname(fileURLToPath(import.meta.url))

export type ProtocolReport = (level: "warning" | "error", message: string, data: Record<string, unknown>) => void

// The entry module registers the handler the moment the first window exists, before logging is up,
// so problems go to the console until the logging layer installs a reporter.
let report: ProtocolReport = (level, message, data) => console[level === "error" ? "error" : "warn"](message, data)

export function setProtocolReporter(reporter: ProtocolReport) {
  report = reporter
}

// Requests in flight and when the last one arrived. The entry module holds the main bundle back
// until the renderer's initial burst of asset requests has been answered, because this handler
// runs on the main thread and a 100 ms module evaluation would otherwise sit between the renderer
// and its HTML.
let inflight = 0
let served = 0
let lastRequest = 0

export function rendererAssetsServed(options: { quietMs: number; capMs: number }) {
  const start = Date.now()
  return new Promise<void>((resolve) => {
    const check = () => {
      const now = Date.now()
      if (now - start >= options.capMs) return resolve()
      if (served > 0 && inflight === 0 && now - lastRequest >= options.quietMs) return resolve()
      setTimeout(check, 5)
    }
    check()
  })
}

export function registerRendererProtocol(rendererRoot: string) {
  if (protocol.isProtocolHandled(rendererProtocol)) return

  protocol.handle(rendererProtocol, async (request) => {
    inflight++
    lastRequest = Date.now()
    try {
      return await serve(request, rendererRoot)
    } finally {
      inflight--
      served++
    }
  })
}

// Serves the bundled Moonshine speech model over grist-speech://models/<file> so dictation runs
// fully on-device. Registered alongside the renderer protocol wherever windows are created.
export function registerSpeechProtocol() {
  if (protocol.isProtocolHandled(SPEECH_PROTOCOL)) return

  protocol.handle(SPEECH_PROTOCOL, async (request) => {
    const assets = speechResourceRoot({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      packageRoot: path.join(root, "../.."),
    })
    const file = resolveSpeechAsset(request.url, assets)
    if (!file) {
      report("warning", "rejected speech path", { url: request.url })
      return speechNotFound()
    }

    try {
      const response = await net.fetch(pathToFileURL(file).toString())
      const headers = new Headers(response.headers)
      headers.set("Access-Control-Allow-Origin", "*")
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    } catch (error) {
      report("error", "speech fetch error", { url: request.url, file, error })
      return speechNotFound()
    }
  })
}

function speechNotFound() {
  return new Response("Not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } })
}

async function serve(request: Request, rendererRoot: string) {
  const url = new URL(request.url)
  if (url.host !== rendererHost) {
    report("warning", "rejected host", { url: request.url })
    return new Response("Not found", { status: 404 })
  }

  const file = path.resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`)
  const rel = path.relative(rendererRoot, file)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    report("warning", "rejected path", { url: request.url, file })
    return new Response("Not found", { status: 404 })
  }

  try {
    const range = request.headers.get("range")
    const response = await net.fetch(pathToFileURL(file).toString(), { headers: range ? { range } : undefined })
    if (response.status >= 400) {
      report("error", "fetch failed", {
        url: request.url,
        file,
        status: response.status,
        statusText: response.statusText,
      })
    }
    return addDocumentPolicy(response, file)
  } catch (error) {
    report("error", "fetch error", { url: request.url, file, error })
    return new Response("Not found", { status: 404 })
  }
}

function addDocumentPolicy(response: Response, file: string) {
  if (!file.toLowerCase().endsWith(".html")) return response
  const headers = new Headers(response.headers)
  headers.set(documentPolicyHeader, jsCallStacksDocumentPolicy)
  headers.set(coopHeader, isolationPolicy)
  headers.set(coepHeader, embedderPolicy)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
