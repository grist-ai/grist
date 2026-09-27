import path from "path"
import { describe, expect, test } from "bun:test"
import type { ConfigDiscovery } from "@opencode/core/config/discovery"
import { ConfigWatch } from "@opencode/core/config/watch"
import { AbsolutePath } from "@opencode/core/schema"

const project = path.resolve("watch-plan-project")
const root = AbsolutePath.make(path.join(project, ".opencode"))
const gristRoot = AbsolutePath.make(path.join(project, ".grist"))
const sources: ConfigDiscovery.Sources = {
  direct: ["opencode.json", "opencode.jsonc", "grist.json", "grist.jsonc"].map((name) =>
    AbsolutePath.make(path.join(project, name)),
  ),
  project: [
    { path: root, present: false },
    { path: gristRoot, present: false },
  ],
  claude: [AbsolutePath.make(path.join(project, ".claude"))],
  agents: [AbsolutePath.make(path.join(project, ".agents"))],
}

describe("ConfigWatch.plan", () => {
  test("groups missing candidates and keeps parent watches when roots appear", () => {
    const missing = ConfigWatch.plan(sources)
    expect(Array.from(missing.values())).toEqual([
      { path: project, type: "entries", names: [".agents", ".claude", ".grist", ".opencode", "grist.json", "grist.jsonc", "opencode.json", "opencode.jsonc"] },
    ])
    const present = ConfigWatch.plan({
      ...sources,
      project: [
        { path: root, present: true },
        { path: gristRoot, present: false },
      ],
    })
    expect(Array.from(present.values())).toEqual([
      { path: root, type: "directory", ignore: ["node_modules", ".git", "**/{node_modules,.git}/**"] },
      ...missing.values(),
    ])
  })

  test("adds exact watches for explicit files only when not already covered", () => {
    expect(ConfigWatch.plan({ ...sources, explicit: sources.direct[0] })).toEqual(ConfigWatch.plan(sources))
    const present = { ...sources, project: [{ path: root, present: true }] }
    expect(ConfigWatch.plan({ ...present, explicit: AbsolutePath.make(path.join(root, "custom.json")) })).toEqual(
      ConfigWatch.plan(present),
    )
    const directory = path.resolve("watch-plan-external")
    expect(
      Array.from(
        ConfigWatch.plan({ ...sources, explicit: AbsolutePath.make(path.join(directory, "custom.json")) }).values(),
      ),
    ).toContainEqual({ path: directory, type: "entries", names: ["custom.json"] })
  })
})
