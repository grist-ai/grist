export * as ConfigTeamObjectsPlugin from "./team-objects.js"

import { define } from "@opencode/plugin/effect/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import path from "path"
import { Effect, FiberMap, PubSub, Semaphore, Stream } from "effect"
import { Agent } from "../../agent.js"
import { Watcher } from "../../filesystem/watcher.js"
import { Location } from "../../location.js"
import { Skill } from "../../skill.js"
import { ConfigMarkdown } from "../markdown.js"
import { SkillFile } from "./skill-file.js"

/**
 * Team objects (filesystem spec v1 §6, D-FS6): skills and agent
 * definitions a teammate published, materialized by the harness sync
 * under `.grist/team/` (this repo's container) and `.grist/team-global/`
 * (the reserved team-global container). The paths mirror
 * @grist-ai/logic's teamObjectsRoot/teamGlobalObjectsRoot — core cannot
 * depend on the logic package, so keep the two in sync.
 *
 * Precedence (D-FS6): this plugin registers before the repo-local
 * loaders, and its transforms only fill ids that are still empty, so a
 * repo-local skill or agent definition of the same name shadows the
 * team copy, and a team object named after a built-in loses to the
 * built-in. Within the team roots, the per-repo root shadows the
 * team-global root. `rung_ceiling` is carried in the materialized
 * frontmatter but not applied by this loader in v1 — the Jev gate owns
 * rung enforcement.
 */

type TeamAgent = {
  readonly id: string
  readonly description?: string
  readonly mode: "primary" | "subagent"
  readonly tools?: readonly string[]
  readonly system: string
}

export const Plugin = define({
  id: "grist.config.team-objects",
  effect: Effect.fn(function* (ctx) {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const watcher = yield* Watcher.Service
    // Lower precedence first: team-global, then this repo's container.
    const roots = [
      path.join(location.directory, ".grist", "team-global"),
      path.join(location.directory, ".grist", "team"),
    ]
    const loaded: { skills: Skill.Info[]; agents: TeamAgent[] } = { skills: [], agents: [] }
    const watches = yield* FiberMap.make<string>()
    const changes = yield* PubSub.sliding<string>(1)
    const lock = Semaphore.makeUnsafe(1)

    const watch = Effect.fn("ConfigTeamObjectsPlugin.watch")(function* (
      directory: string,
      type: "file" | "directory",
    ) {
      const target = path.resolve(directory)
      const updates = yield* watcher.subscribe({ path: target, type })
      yield* FiberMap.run(
        watches,
        `${type}:${target}`,
        updates.pipe(Stream.runForEach((update) => PubSub.publish(changes, update.path).pipe(Effect.asVoid))),
        { onlyIfMissing: true, startImmediately: true },
      )
    })

    function firstMissing(target: string): Effect.Effect<string | undefined> {
      const parent = path.dirname(target)
      if (parent === target) return Effect.undefined
      return fs.isDir(parent).pipe(Effect.flatMap((exists) => (exists ? Effect.succeed(target) : firstMissing(parent))))
    }

    const watchRoot: (directory: string) => Effect.Effect<void> = Effect.fn("ConfigTeamObjectsPlugin.watchRoot")(
      function* (directory: string) {
        const target = path.resolve(directory)
        const resolved = yield* fs.realPath(directory).pipe(Effect.orElseSucceed(() => undefined))
        if (resolved) {
          yield* watch(resolved, "directory")
          if (resolved !== target) yield* watch(target, "file")
          return
        }
        const missing = yield* firstMissing(target)
        if (missing) yield* watch(missing, "file")
        if (
          yield* fs.realPath(directory).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          )
        ) {
          if (missing) yield* FiberMap.remove(watches, `file:${path.resolve(missing)}`)
          return yield* watchRoot(directory)
        }
      },
    )

    const loadSkills = Effect.fn("ConfigTeamObjectsPlugin.loadSkills")(function* (root: string) {
      const directory = path.join(root, "skill")
      const files = yield* fs
        .scan("{*.md,**/SKILL.md}", { cwd: directory, absolute: true, include: "file", symlink: true, dot: true })
        .pipe(Effect.orElseSucceed(() => [] as string[]))
      const skills: Skill.Info[] = []
      for (const filepath of files.toSorted()) {
        const content = yield* fs.readFileStringSafe(filepath).pipe(Effect.orElseSucceed(() => undefined))
        if (!content) continue
        const parsed = SkillFile.parse(directory, filepath, content)
        if (parsed._tag === "Skipped") continue
        skills.push(parsed.skill)
      }
      return skills
    })

    const loadAgents = Effect.fn("ConfigTeamObjectsPlugin.loadAgents")(function* (root: string) {
      const directory = path.join(root, "agent_definition")
      const files = yield* fs
        .scan("*.md", { cwd: directory, absolute: true, include: "file", symlink: true, dot: true })
        .pipe(Effect.orElseSucceed(() => [] as string[]))
      const agents: TeamAgent[] = []
      for (const filepath of files.toSorted()) {
        const content = yield* fs.readFileStringSafe(filepath).pipe(Effect.orElseSucceed(() => undefined))
        if (!content) continue
        const markdown = ConfigMarkdown.parseOption(content)
        if (!markdown) continue
        const tools = markdown.data.tools
        agents.push({
          id: path.basename(filepath, ".md"),
          ...(typeof markdown.data.description === "string" ? { description: markdown.data.description } : {}),
          mode: markdown.data.mode === "primary" ? "primary" : "subagent",
          ...(Array.isArray(tools) && tools.every((tool) => typeof tool === "string")
            ? { tools: tools as string[] }
            : {}),
          system: markdown.content.trim(),
        })
      }
      return agents
    })

    const refresh = Effect.fn("ConfigTeamObjectsPlugin.refresh")(
      function* () {
        yield* FiberMap.clear(watches)
        const skills = new Map<Skill.ID, Skill.Info>()
        const agents = new Map<string, TeamAgent>()
        for (const root of roots) {
          yield* watchRoot(root)
          for (const skill of yield* loadSkills(root)) skills.set(skill.id, skill)
          for (const agent of yield* loadAgents(root)) agents.set(agent.id, agent)
        }
        loaded.skills = Array.from(skills.values())
        loaded.agents = Array.from(agents.values())
      },
      (effect) => lock.withPermit(effect),
    )

    // Subscribe before debouncing so no update slips through while the
    // debounce starts its pull (same pattern as ConfigSkillPlugin).
    const updates = yield* PubSub.subscribe(changes)
    yield* Stream.fromSubscription(updates).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() => refresh().pipe(Effect.andThen(ctx.skill.reload()), Effect.andThen(ctx.agent.reload()))),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh()
    yield* ctx.skill.transform((editor) => {
      for (const skill of loaded.skills) {
        // Fill only empty ids: built-ins are already present when this
        // transform runs, and the repo-local loaders run after it and
        // overwrite by id — local shadows team (D-FS6).
        if (editor.get(skill.id) === undefined) editor.add(skill)
      }
    })
    yield* ctx.agent.transform((editor) => {
      for (const def of loaded.agents) {
        const id = Agent.ID.make(def.id)
        if (editor.get(id) !== undefined) continue
        editor.update(id, (agent) => {
          agent.system = def.system
          if (def.description !== undefined) agent.description = def.description
          agent.mode = def.mode
          if (def.tools !== undefined) {
            // A definition's tool list is an allowlist: deny everything,
            // then allow the named tools (the built-in explore pattern;
            // Permission.evaluate lets the last matching rule win).
            agent.permissions.push({ action: "*", resource: "*", effect: "deny" })
            for (const tool of def.tools) agent.permissions.push({ action: tool, resource: "*", effect: "allow" })
          }
        })
      }
    })
  }),
})
