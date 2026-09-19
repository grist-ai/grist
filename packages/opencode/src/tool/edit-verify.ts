import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { EditTool, Parameters as EditParameters } from "./edit"
import { ShellTool } from "./shell"
import { Parameters as ShellParameters } from "./shell/prompt"
import { PositiveInt } from "@opencode-ai/core/schema"
import DESCRIPTION from "./edit-verify.txt"
import { formatFusion } from "@/grist/action-fusion"

/**
 * SoL-Pi Action Fusion (pre-POC §5): one tool call = file edit + verify command.
 * Prefer this over separate edit → bash when the change has a clear check.
 */
export const Parameters = Schema.Struct({
  filePath: EditParameters.fields.filePath,
  oldString: EditParameters.fields.oldString,
  newString: EditParameters.fields.newString,
  replaceAll: EditParameters.fields.replaceAll,
  verify: Schema.String.annotate({
    description: "Shell command to run after the edit (test, typecheck, build, etc.)",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Optional verify-command timeout in milliseconds",
  }),
  workdir: ShellParameters.fields.workdir,
})

export const EditVerifyTool = Tool.define(
  "edit_verify",
  Effect.gen(function* () {
    const editInfo = yield* EditTool
    const shellInfo = yield* ShellTool
    const edit = yield* Tool.init(editInfo)
    const shell = yield* Tool.init(shellInfo)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const editResult = yield* edit.execute(
            {
              filePath: params.filePath,
              oldString: params.oldString,
              newString: params.newString,
              replaceAll: params.replaceAll,
            },
            ctx,
          )

          const verifyResult = yield* shell.execute(
            {
              command: params.verify,
              timeout: params.timeout,
              workdir: params.workdir,
            },
            ctx,
          )

          const exit =
            typeof verifyResult.metadata?.exit === "number" ? verifyResult.metadata.exit : undefined

          const verifyMeta = verifyResult.metadata as {
            truncated?: boolean
            outputPath?: string
            exit?: number | null
          }

          return {
            title: `edit_verify ${params.filePath}`,
            metadata: {
              fused: true,
              filePath: params.filePath,
              verify: params.verify,
              exit,
              edit: editResult.metadata,
              verifyMeta: verifyResult.metadata,
              truncated: Boolean(verifyMeta.truncated),
              ...(verifyMeta.outputPath ? { outputPath: verifyMeta.outputPath } : {}),
            },
            output: formatFusion({
              filePath: params.filePath,
              editOutput: editResult.output,
              verifyCommand: params.verify,
              verifyOutput: verifyResult.output,
              exit,
            }),
            attachments: [...(editResult.attachments ?? []), ...(verifyResult.attachments ?? [])],
          }
        }),
    }
  }),
)
