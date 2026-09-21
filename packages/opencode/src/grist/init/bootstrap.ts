import fs from "fs"
import path from "path"
import { Process } from "@/util/process"
import { mineOwnership } from "./ownership"

export type BootstrapResult = {
  directory: string
  outDir: string
  sha: string
  ownershipRows: number
  ownershipPath: string
  graphPath?: string
  nextPath: string
  notes: string[]
}

/** Cold-start bootstrap: pin SHA → optional Graphify → ownership mine. */
export async function bootstrapCodebase(input?: {
  cwd?: string
  since?: string
  limit?: number
  skipGraph?: boolean
}): Promise<BootstrapResult> {
  const directory = path.resolve(input?.cwd ?? process.cwd())
  if (!fs.existsSync(path.join(directory, ".git"))) {
    throw new Error(`${directory} is not a git repository`)
  }

  const outDir = process.env.GRIST_BOOTSTRAP_OUT?.trim() || path.join(directory, ".grist", "bootstrap")
  fs.mkdirSync(outDir, { recursive: true })

  const shaResult = await Process.run(["git", "-C", directory, "rev-parse", "HEAD"])
  const sha = shaResult.stdout.toString("utf8").trim()
  fs.writeFileSync(path.join(outDir, "pinned-sha.txt"), `${sha}\n`)

  const notes: string[] = []
  let graphPath: string | undefined

  if (!input?.skipGraph) {
    const graphify = Bun.which("graphify")
    if (graphify) {
      const graphOut = path.join(outDir, "graphify-out")
      const run = await Process.run([graphify, ".", "--out", graphOut], {
        cwd: directory,
        nothrow: true,
      })
      const candidate = path.join(graphOut, "graph.json")
      if (run.code === 0 && fs.existsSync(candidate)) {
        const link = path.join(outDir, "graph.json")
        try {
          fs.rmSync(link, { force: true })
          fs.symlinkSync(candidate, link)
        } catch {
          fs.copyFileSync(candidate, link)
        }
        graphPath = link
        notes.push(`code map → ${link}`)
      } else {
        notes.push("graphify ran but graph.json was not produced")
      }
    } else {
      notes.push("graphify not on PATH — skipped code map (install later for bake-off)")
    }
  }

  const since = input?.since ?? process.env.GRIST_BOOTSTRAP_SINCE ?? "18months"
  const limit = input?.limit ?? Number(process.env.GRIST_BOOTSTRAP_OWNERSHIP_LIMIT ?? 5000)
  const mined = await mineOwnership({ repo: directory, since, limit })
  const ownershipPath = path.join(outDir, "ownership.jsonl")
  fs.writeFileSync(ownershipPath, mined.rows.map((row) => JSON.stringify(row)).join("\n") + (mined.rows.length ? "\n" : ""))

  const nextPath = path.join(outDir, "NEXT.md")
  fs.writeFileSync(
    nextPath,
    `# Bootstrap next steps

Pinned SHA: \`${sha}\`

1. Review \`${ownershipPath}\` — only \`memory remember\` user-approved rows.
2. Run Graphify vs CRG bake-off (\`docs/code-map.md\`) on this SHA.
3. Optional map-reduce distillation (~$50–200 frontier) for team profile.
4. Start shadow burn-in via the invite gateway; report via burn-in tools.
5. Fill the tech-lead questionnaire for the unresolvable remainder.

Ownership rows mined: **${mined.rows.length}** (since ${mined.since}).
`,
  )

  return {
    directory,
    outDir,
    sha,
    ownershipRows: mined.rows.length,
    ownershipPath,
    graphPath,
    nextPath,
    notes,
  }
}
