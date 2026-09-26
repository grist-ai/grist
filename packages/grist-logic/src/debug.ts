import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Grist diagnostic logger. Never writes to stdout/stderr by default —
 * those corrupt the TUI. Opt in with `GRIST_DEBUG=1` (stderr) or
 * `GRIST_DEBUG=file` (append to ~/.grist/debug.log).
 */
export function gristLog(line: string) {
  const mode = (process.env.GRIST_DEBUG ?? "").trim().toLowerCase()
  if (!mode || mode === "0" || mode === "off" || mode === "false") return

  const text = line.endsWith("\n") ? line : `${line}\n`
  if (mode === "file" || mode === "log") {
    const file = process.env.GRIST_DEBUG_PATH?.trim() || path.join(os.homedir(), ".grist", "debug.log")
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, text)
    } catch {
      // ignore — diagnostics must never break the agent loop
    }
    return
  }

  // GRIST_DEBUG=1 / true / stderr
  try {
    process.stderr.write(text)
  } catch {
    // ignore
  }
}

export function gristWarn(line: string, error?: unknown) {
  const detail = error === undefined ? "" : ` ${error instanceof Error ? error.message : String(error)}`
  gristLog(`${line}${detail}`)
}
