/**
 * D3 — the review model: chunk-level decisions over a file diff.
 *
 * The runtime's review panel already renders diffs and turns line
 * comments into composer chips. What it cannot do is ACT on a review:
 * accept some chunks, revert others, and commit what was accepted.
 * This module owns the pure half of that — unified-diff surgery over
 * the wire shape (`FileDiff.Info`: one patch string per file):
 *
 *   - a patch parses into hunks with stable identities
 *     (`<file>#<oldStart>` — line-anchored, so a decision survives a
 *     re-render as long as the underlying diff is unchanged);
 *   - any single hunk becomes a standalone patch (`hunkPatch`) that
 *     `git apply` accepts on its own: applied to the INDEX it stages
 *     exactly that chunk (accept); applied to the WORKING TREE with
 *     `--reverse` it undoes exactly that chunk (revert);
 *   - a line comment composes into a steering message that quotes the
 *     file, the new-file line, and the comment (`commentSteerText`) —
 *     the text contract behind comment → agent-revises.
 *
 * Patch text from `git diff` uses `\n` line endings and may contain
 * "\ No newline at end of file" markers; both are preserved verbatim.
 */

export type ReviewHunk = {
  /** Stable identity: `<file>#<oldStart>`. */
  id: string
  file: string
  /** The `@@ -a,b +c,d @@` header line. */
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** Hunk body lines, each starting with ' ', '+', '-', or '\'. */
  lines: string[]
  additions: number
  deletions: number
}

export type FilePatch = {
  file: string
  /** Everything before the first hunk (diff --git / index / --- / +++ lines). */
  preamble: string[]
  hunks: ReviewHunk[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Parse one file's unified diff (as carried by `FileDiff.Info.patch`). */
export function parseFilePatch(file: string, patch: string): FilePatch {
  const preamble: string[] = []
  const hunks: ReviewHunk[] = []
  let current: ReviewHunk | undefined
  for (const line of patch.split("\n")) {
    const match = HUNK_HEADER.exec(line)
    if (match) {
      current = {
        id: `${file}#${match[1]}`,
        file,
        header: line,
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? "1"),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? "1"),
        lines: [],
        additions: 0,
        deletions: 0,
      }
      hunks.push(current)
      continue
    }
    if (!current) {
      if (line.length > 0) preamble.push(line)
      continue
    }
    if (line.startsWith("+")) current.additions++
    if (line.startsWith("-")) current.deletions++
    current.lines.push(line)
  }
  // A trailing newline in the patch yields one empty final line per hunk;
  // it is not content.
  for (const hunk of hunks) {
    while (hunk.lines.length > 0 && hunk.lines[hunk.lines.length - 1] === "") hunk.lines.pop()
  }
  return { file, preamble, hunks }
}

/** Reassemble a patch containing only the given hunks of one file. */
export function hunksPatch(parsed: FilePatch, hunks: readonly ReviewHunk[]): string {
  if (hunks.length === 0) return ""
  return [...parsed.preamble, ...hunks.flatMap((hunk) => [hunk.header, ...hunk.lines])].join("\n") + "\n"
}

/** A standalone patch for one hunk — stage it with `git apply --cached`. */
export function hunkPatch(parsed: FilePatch, hunk: ReviewHunk): string {
  return hunksPatch(parsed, [hunk])
}

/**
 * Reverting a hunk needs no patch surgery here: pass the hunk's own
 * patch to `git apply --reverse` and git swaps the direction itself.
 * Accept and revert therefore share one artifact — `hunkPatch` — with
 * the direction carried by the apply call, never by edited patch text.
 */
export type HunkDecision = "accepted" | "reverted"

/** The steering message for a line comment on a diff. */
export function commentSteerText(input: { file: string; line: number; comment: string; snippet?: string }): string {
  const where = `In ${input.file} at line ${input.line}`
  const quote = input.snippet ? `:\n> ${input.snippet}` : ""
  return `${where}${quote}\n${input.comment}`
}
