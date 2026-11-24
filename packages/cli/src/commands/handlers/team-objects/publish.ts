import { EOL } from "node:os"
import fs from "node:fs"
import path from "node:path"
import { Effect, Option } from "effect"
import {
  buildAgentDefinitionObject,
  buildSkillObject,
  containerForDirectory,
  loadTeamSyncState,
  newTeamObjectId,
  publishTeamObject,
  TEAM_GLOBAL_CONTAINER,
  validateTeamObject,
  type TeamObjectKind,
  type TeamObjectWire,
} from "@grist-ai/logic"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

/**
 * `grist team-objects publish <path>` — the v1 authoring path for the
 * team filesystem (filesystem spec v1 §6): read a local skill or agent
 * definition, validate it the way the gateway will, and push it as a
 * new version of its (container, kind, name) chain. Re-publishing an
 * edited file supersedes the last known head automatically.
 */
export default Runtime.handler(Commands.commands["team-objects"].commands.publish, (input) =>
  Effect.promise(async () => {
    const cwd = process.cwd()
    const json = input.format === "json"
    const fail = (message: string) => {
      process.exitCode = 1
      process.stdout.write((json ? JSON.stringify({ error: message }, null, 2) : `Cannot publish: ${message}`) + EOL)
    }

    const resolved = path.resolve(cwd, input.path)
    let content: string
    let inferred: TeamObjectKind
    let fallbackName: string
    try {
      const stat = fs.statSync(resolved)
      if (stat.isDirectory()) {
        const skillFile = path.join(resolved, "SKILL.md")
        content = fs.readFileSync(skillFile, "utf-8")
        inferred = "skill"
        fallbackName = path.basename(resolved)
      } else {
        content = fs.readFileSync(resolved, "utf-8")
        if (path.basename(resolved) === "SKILL.md") {
          inferred = "skill"
          fallbackName = path.basename(path.dirname(resolved))
        } else if (["skills", "skill"].includes(path.basename(path.dirname(resolved)))) {
          inferred = "skill"
          fallbackName = path.basename(resolved).replace(/\.md$/, "")
        } else {
          inferred = "agent_definition"
          fallbackName = path.basename(resolved).replace(/\.md$/, "")
        }
      }
    } catch {
      return fail(`cannot read ${input.path} (a skill directory must contain a SKILL.md)`)
    }

    const state = await loadTeamSyncState(cwd)
    if (!state.enabled) {
      return fail(`team sync is off for ${cwd} — opt in first: grist team-memory enable`)
    }

    const kind = Option.getOrUndefined(input.kind) ?? inferred
    const container = input.global ? TEAM_GLOBAL_CONTAINER : containerForDirectory(cwd)
    const shared = { container, id: newTeamObjectId() }
    const object: TeamObjectWire =
      kind === "skill"
        ? buildSkillObject({
            ...shared,
            content,
            fallbackName,
            description: Option.getOrUndefined(input.description),
          })
        : buildAgentDefinitionObject({ ...shared, content, fallbackName })

    const invalid = validateTeamObject(object)
    if (invalid) return fail(`the gateway would reject this ${kind} (${invalid}) — fix the file and retry`)

    const chainKey = `${object.kind}:${object.container}:${object.name}`
    const supersedes = state.objects.pushedHeads[chainKey] ?? state.objects.manifest[chainKey]?.id ?? null
    const { queue, push } = await publishTeamObject(cwd, object)
    if (queue === "rejected") {
      const reason = (await loadTeamSyncState(cwd)).objects.rejected[object.id]?.reason ?? "rejected"
      return fail(`held locally (${reason})`)
    }
    const after = await loadTeamSyncState(cwd)
    const gatewayRejection = after.objects.rejected[object.id]?.reason
    if (gatewayRejection) return fail(`the gateway rejected this ${kind} (${gatewayRejection})`)

    const stored = push.stored > 0
    const report = {
      id: object.id,
      kind: object.kind,
      name: object.name,
      container: object.container,
      supersedes,
      stored,
      queued: !stored,
      ...(push.error ? { error: push.error } : {}),
    }
    if (json) {
      process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      return
    }
    process.stdout.write(
      stored
        ? `Published ${object.kind} "${object.name}" (${object.id}) to your team · container ${object.container}` + EOL
        : `Queued ${object.kind} "${object.name}" (${object.id}) — the gateway was unreachable (${push.error ?? "offline"}); it will push on the next sync.` +
            EOL,
    )
  }),
)
