import fs from "fs"
import path from "path"

export const CONFIG_NAME = "opencode.jsonc"

export const DEFAULT_CONFIG = `{
  "$schema": "https://opencode.ai/config.json",
  // One key for the whole ladder: export OPENROUTER_API_KEY=sk-or-v1-...
  "model": "openrouter/deepseek/deepseek-v4.1-flash",
  "lsp": true,
  "provider": {
    "openrouter": {
      "options": {
        "headers": {
          "HTTP-Referer": "https://github.com/pranav6226/grist",
          "X-Title": "Grist"
        }
      }
    }
  }
}
`

export const GRIST_DIR_README = `# Grist workspace

Local Grist state for this codebase (gitignored by default).

| Path | Purpose |
| --- | --- |
| \`memory.json\` | File-store memory fallback (when Supermemory is off) |
| \`burn-in.jsonl\` | Gate decisions for threshold calibration |
| \`bootstrap/\` | Cold-start ownership mine + optional code map |

## Next steps

1. \`export OPENROUTER_API_KEY=…\` (required)
2. Optional: \`export TYPESAFE_API_KEY=…\` for live Jev routing
3. Optional: \`bunx supermemory local install\` then keep \`supermemory-server\` available
4. \`grist bootstrap\` — mine ownership / build map (review before \`memory remember\`)
5. \`grist\` — start the agent in this repo

See docs: memory.md, gate.md, code-map.md, shadow-burn-in.md
`

export type InitResult = {
  directory: string
  created: string[]
  skipped: string[]
  warnings: string[]
}

/** Scaffold `.grist/`, config, and gitignore for a codebase. */
export function scaffoldGrist(input?: { cwd?: string; force?: boolean }): InitResult {
  const directory = path.resolve(input?.cwd ?? process.cwd())
  const force = input?.force ?? false
  const created: string[] = []
  const skipped: string[] = []
  const warnings: string[] = []

  const gristDir = path.join(directory, ".grist")
  const bootstrapDir = path.join(gristDir, "bootstrap")
  ensureDir(gristDir, created, skipped)
  ensureDir(bootstrapDir, created, skipped)

  writeIfMissing(path.join(gristDir, "README.md"), GRIST_DIR_README, created, skipped, force)

  const configPath = path.join(directory, CONFIG_NAME)
  const altConfig = path.join(directory, "opencode.json")
  if (fs.existsSync(configPath) || fs.existsSync(altConfig)) {
    skipped.push(path.relative(directory, configPath) || CONFIG_NAME)
  } else {
    fs.writeFileSync(configPath, DEFAULT_CONFIG)
    created.push(CONFIG_NAME)
  }

  const gitignore = path.join(directory, ".gitignore")
  if (fs.existsSync(gitignore)) {
    const text = fs.readFileSync(gitignore, "utf8")
    if (!/(^|\n)\.grist\/?(\n|$)/.test(text)) {
      const next = text.endsWith("\n") ? `${text}.grist/\n` : `${text}\n.grist/\n`
      fs.writeFileSync(gitignore, next)
      created.push(".gitignore (+ .grist/)")
    } else {
      skipped.push(".gitignore (.grist/ already present)")
    }
  } else {
    fs.writeFileSync(gitignore, ".grist/\n")
    created.push(".gitignore")
  }

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    warnings.push("OPENROUTER_API_KEY is not set — export it before running grist")
  }
  if (!process.env.TYPESAFE_API_KEY?.trim()) {
    warnings.push("TYPESAFE_API_KEY is not set — gate will use shadow heuristics until set")
  }

  return { directory, created, skipped, warnings }
}

function ensureDir(dir: string, created: string[], skipped: string[]) {
  if (fs.existsSync(dir)) {
    skipped.push(path.basename(dir) === ".grist" ? ".grist/" : `${path.basename(path.dirname(dir))}/${path.basename(dir)}/`)
    return
  }
  fs.mkdirSync(dir, { recursive: true })
  created.push(dir.endsWith(`${path.sep}bootstrap`) ? ".grist/bootstrap/" : ".grist/")
}

function writeIfMissing(
  file: string,
  contents: string,
  created: string[],
  skipped: string[],
  force: boolean,
) {
  const rel = file.includes(`${path.sep}.grist${path.sep}`)
    ? `.grist/${path.basename(file)}`
    : path.basename(file)
  if (fs.existsSync(file) && !force) {
    skipped.push(rel)
    return
  }
  fs.writeFileSync(file, contents)
  created.push(rel)
}
