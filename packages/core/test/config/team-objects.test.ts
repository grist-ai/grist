import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Directory, type Entry } from "@opencode/schema/config"
import { ConfigAgentPlugin } from "@opencode/core/config/plugin/agent"
import { ConfigSkillPlugin } from "@opencode/core/config/plugin/skill"
import { ConfigTeamObjectsPlugin } from "@opencode/core/config/plugin/team-objects"
import { AgentPlugin } from "@opencode/core/plugin/agent"
import { SkillPlugin } from "@opencode/core/plugin/skill"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { SkillDiscovery } from "@opencode/core/skill/discovery"
import { tmpdir } from "../fixture/tmpdir"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { agentHost, host } from "../plugin/host"

const it = testEffect(
  Layer.merge(
    AppNodeBuilder.build(LayerNode.group([Skill.node, Agent.node, Bus.node, FSUtil.node, Global.node])),
    Watcher.testLayer,
  ),
)
const emptyDiscovery = SkillDiscovery.Service.of({ pull: () => Effect.succeed([]) })

const skillFile = (name: string, description: string, body = `# ${name}`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`

const agentFile = (description: string, body: string) =>
  `---\ndescription: "${description}"\nmode: subagent\ntools: ["read", "grep"]\nrung_ceiling: "medium"\n---\n${body}`

/**
 * Runs the built-in plugins (pre) and then the team-objects plugin,
 * mirroring the production registration order in plugin/internal.ts:
 * built-ins first, team objects before the repo-local loaders.
 */
const startTeam = Effect.fnUntraced(function* (directory: string, entries: Entry[] = []) {
  const skill = yield* Skill.Service
  const agent = yield* Agent.Service
  const pluginHost = host({
    skill: {
      list: () => Effect.die("unused skill.list"),
      transform: skill.transform,
      reload: skill.reload,
    },
    agent: agentHost(agent),
  })
  const config = Config.testLayer(entries)
  yield* SkillPlugin.Plugin.effect(pluginHost).pipe(Effect.provide(config))
  yield* AgentPlugin.Plugin.effect(pluginHost)
  yield* ConfigTeamObjectsPlugin.Plugin.effect(pluginHost).pipe(
    Effect.provideService(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
  )
  return { skill, agent, pluginHost, config }
})

function emitAndWait(update: Watcher.Update) {
  return Effect.gen(function* () {
    const watcher = yield* Watcher.Test
    const bus = yield* Bus.Service
    const deferred = yield* Deferred.make<void>()
    const fiber = yield* bus.subscribe(Skill.Event.Updated).pipe(
      Stream.runForEach(() => Deferred.succeed(deferred, undefined).pipe(Effect.asVoid)),
      Effect.forkScoped,
    )
    yield* Effect.yieldNow
    yield* watcher.emit(update)
    yield* Deferred.await(deferred).pipe(Effect.timeout("2 seconds"))
    yield* Fiber.interrupt(fiber)
  })
}

describe("ConfigTeamObjectsPlugin.Plugin", () => {
  it.live("loads materialized team skills and agent definitions", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const team = path.join(tmp.path, ".grist", "team")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(team, "skill", "deploy-check"), { recursive: true })
            await fs.mkdir(path.join(team, "agent_definition"), { recursive: true })
            await fs.writeFile(
              path.join(team, "skill", "deploy-check", "SKILL.md"),
              skillFile("deploy-check", "Pre-deploy verification", "Run the smoke suite."),
            )
            await fs.writeFile(
              path.join(team, "agent_definition", "reviewer.md"),
              agentFile("Reviews diffs", "You review diffs for correctness."),
            )
          })

          const { skill, agent } = yield* startTeam(tmp.path)
          const loaded = (yield* skill.list()).find((item) => item.id === "deploy-check")
          expect(loaded?.description).toBe("Pre-deploy verification")
          expect(loaded?.content).toContain("Run the smoke suite.")

          const reviewer = yield* agent.get(Agent.ID.make("reviewer"))
          expect(reviewer?.system).toBe("You review diffs for correctness.")
          expect(reviewer?.description).toBe("Reviews diffs")
          expect(reviewer?.mode).toBe("subagent")
          // The definition's tool list is an allowlist over a deny-all base.
          expect(Permission.evaluate("read", "*", reviewer?.permissions ?? []).effect).toBe("allow")
          expect(Permission.evaluate("grep", "*", reviewer?.permissions ?? []).effect).toBe("allow")
          expect(Permission.evaluate("edit", "*", reviewer?.permissions ?? []).effect).toBe("deny")
        }),
      ),
    ),
  )

  it.live("loads nothing when the repo has no materialized team objects", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const { skill, agent } = yield* startTeam(tmp.path)
          expect((yield* skill.list()).map((item) => item.id).toSorted()).toEqual([
            Skill.ID.make("opencode"),
            Skill.ID.make("report"),
          ])
          expect(yield* agent.get(Agent.ID.make("reviewer"))).toBeUndefined()
        }),
      ),
    ),
  )

  it.live("team-global loads at lower precedence than the per-repo root", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const team = path.join(tmp.path, ".grist", "team")
          const global = path.join(tmp.path, ".grist", "team-global")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(team, "skill", "house-style"), { recursive: true })
            await fs.mkdir(path.join(global, "skill", "house-style"), { recursive: true })
            await fs.mkdir(path.join(global, "skill", "brand-voice"), { recursive: true })
            await fs.writeFile(path.join(team, "skill", "house-style", "SKILL.md"), skillFile("house-style", "Repo"))
            await fs.writeFile(
              path.join(global, "skill", "house-style", "SKILL.md"),
              skillFile("house-style", "Global"),
            )
            await fs.writeFile(
              path.join(global, "skill", "brand-voice", "SKILL.md"),
              skillFile("brand-voice", "Global only"),
            )
          })

          const { skill } = yield* startTeam(tmp.path)
          expect((yield* skill.list()).find((item) => item.id === "house-style")?.description).toBe("Repo")
          expect((yield* skill.list()).find((item) => item.id === "brand-voice")?.description).toBe("Global only")
        }),
      ),
    ),
  )

  it.live("built-ins win over team objects of the same name", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const team = path.join(tmp.path, ".grist", "team")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(team, "skill", "opencode"), { recursive: true })
            await fs.mkdir(path.join(team, "agent_definition"), { recursive: true })
            await fs.writeFile(path.join(team, "skill", "opencode", "SKILL.md"), skillFile("opencode", "Team copy"))
            await fs.writeFile(path.join(team, "agent_definition", "build.md"), agentFile("Team build", "TEAM PROMPT"))
          })

          const { skill, agent } = yield* startTeam(tmp.path)
          expect((yield* skill.list()).find((item) => item.id === "opencode")?.description).toContain(
            "any question about OpenCode itself",
          )
          const build = yield* agent.get(Agent.ID.make("build"))
          expect(build?.description).toBe("The default agent. Executes tools based on configured permissions.")
          expect(build?.system).toBeUndefined()
        }),
      ),
    ),
  )

  it.live("repo-local skills and agents shadow team copies of the same name", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const team = path.join(tmp.path, ".grist", "team")
          const local = path.join(tmp.path, "local")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(team, "skill", "deploy-check"), { recursive: true })
            await fs.mkdir(path.join(team, "agent_definition"), { recursive: true })
            await fs.mkdir(path.join(local, "skill", "deploy-check"), { recursive: true })
            await fs.mkdir(path.join(local, "agents"), { recursive: true })
            await fs.writeFile(
              path.join(team, "skill", "deploy-check", "SKILL.md"),
              skillFile("deploy-check", "Team version"),
            )
            await fs.writeFile(
              path.join(team, "agent_definition", "reviewer.md"),
              agentFile("Team reviewer", "Team prompt."),
            )
            await fs.writeFile(
              path.join(local, "skill", "deploy-check", "SKILL.md"),
              skillFile("deploy-check", "Local version"),
            )
            await fs.writeFile(path.join(local, "agents", "reviewer.md"), "Local prompt.")
          })

          const entries: Entry[] = [new Directory({ type: "directory", path: AbsolutePath.make(local) })]
          const { skill, agent, pluginHost, config } = yield* startTeam(tmp.path, entries)
          // The repo-local loaders register after the team plugin in
          // production (plugin/internal.ts post list).
          yield* ConfigSkillPlugin.Plugin.effect(pluginHost).pipe(
            Effect.provide(config),
            Effect.provideService(SkillDiscovery.Service, emptyDiscovery),
            Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home: tmp.path })),
            Effect.provideService(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
            ),
          )
          yield* ConfigAgentPlugin.Plugin.effect(pluginHost).pipe(
            Effect.provide(config),
            Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home: tmp.path })),
          )

          expect((yield* skill.list()).find((item) => item.id === "deploy-check")?.description).toBe("Local version")
          expect((yield* agent.get(Agent.ID.make("reviewer")))?.system).toBe("Local prompt.")
        }),
      ),
    ),
  )

  it.live("a watcher update on a materialized file reloads the new head", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.path, ".grist", "team", "skill", "deploy-check", "SKILL.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(file), { recursive: true })
            await fs.writeFile(file, skillFile("deploy-check", "First head"))
          })

          const { skill } = yield* startTeam(tmp.path)
          expect((yield* skill.list()).find((item) => item.id === "deploy-check")?.description).toBe("First head")

          yield* Effect.promise(() => fs.writeFile(file, skillFile("deploy-check", "Second head")))
          yield* emitAndWait({ type: "update", path: file })
          expect((yield* skill.list()).find((item) => item.id === "deploy-check")?.description).toBe("Second head")
        }),
      ),
    ),
  )
})
