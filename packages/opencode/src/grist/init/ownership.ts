import { Process } from "@/util/process"

export type OwnershipRow = {
  container: string
  outcome: "user_approved"
  text: string
  meta: { path: string; author: string; commits: number }
}

/** Parse `18months` / `90d` / ISO into a Date. */
export function parseSince(raw: string, now = new Date()): Date {
  const text = raw.trim().toLowerCase()
  if (text.endsWith("months") || text.endsWith("month")) {
    const months = Number(text.replace(/\D/g, "") || "18")
    return new Date(now.getTime() - months * 30 * 24 * 60 * 60 * 1000)
  }
  if (text.endsWith("d") || text.endsWith("days") || text.endsWith("day")) {
    const days = Number(text.replace(/\D/g, "") || "365")
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  }
  return new Date(raw)
}

/**
 * Mine top author per path via `git log` (no pydriller dependency).
 * Rows are for human review before `memory remember` — never auto-persist.
 */
export async function mineOwnership(input: {
  repo: string
  since?: string
  limit?: number
  maxCommits?: number
}): Promise<{ rows: OwnershipRow[]; since: string }> {
  const sinceDate = parseSince(input.since ?? "18months")
  const sinceArg = sinceDate.toISOString().slice(0, 10)
  const maxCount = String(input.maxCommits ?? Number(process.env.GRIST_OWNERSHIP_MAX_COMMITS ?? 5000))

  const result = await Process.run(
    [
      "git",
      "-C",
      input.repo,
      "log",
      `--since=${sinceArg}`,
      `--max-count=${maxCount}`,
      "--format=AUTHOR:%aN",
      "--name-only",
      "--no-merges",
    ],
    { nothrow: true },
  )
  if (result.code !== 0) {
    throw new Error(result.stderr.toString("utf8").trim() || `git log failed (code ${result.code})`)
  }

  const counts = new Map<string, Map<string, number>>()
  let author: string | undefined
  for (const line of result.stdout.toString("utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith("AUTHOR:")) {
      author = trimmed.slice("AUTHOR:".length).trim() || undefined
      continue
    }
    if (!author) continue
    const bucket = counts.get(trimmed) ?? new Map<string, number>()
    bucket.set(author, (bucket.get(author) ?? 0) + 1)
    counts.set(trimmed, bucket)
  }

  const rows: OwnershipRow[] = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([filePath, authors]) => {
      let topAuthor = ""
      let topCommits = 0
      for (const [name, n] of authors) {
        if (n > topCommits) {
          topAuthor = name
          topCommits = n
        }
      }
      return {
        container: "ownership",
        outcome: "user_approved" as const,
        text: `${filePath} owned primarily by ${topAuthor} (${topCommits} commits since ${sinceArg})`,
        meta: { path: filePath, author: topAuthor, commits: topCommits },
      }
    })

  const limited = input.limit && input.limit > 0 ? rows.slice(0, input.limit) : rows
  return { rows: limited, since: sinceArg }
}
