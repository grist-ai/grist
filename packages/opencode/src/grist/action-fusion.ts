/** SoL-Pi Action Fusion helpers (pre-POC §5). */

export function formatFusion(input: {
  filePath: string
  editOutput: string
  verifyCommand: string
  verifyOutput: string
  exit?: number
}): string {
  const status =
    input.exit === undefined ? "unknown" : input.exit === 0 ? "ok" : `failed (exit ${input.exit})`
  return [
    `[grist:action-fusion] edit+verify file=${input.filePath} verify_status=${status}`,
    "",
    "## Edit",
    input.editOutput.trimEnd(),
    "",
    "## Verify",
    `$ ${input.verifyCommand}`,
    input.verifyOutput.trimEnd(),
  ].join("\n")
}
