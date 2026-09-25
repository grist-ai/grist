import { describe, expect, test } from "bun:test"

const dir = import.meta.dir

describe("@grist-ai/grist-skills manifest", () => {
  test("package.json names the org-scoped package with a semver version", async () => {
    const pkg = await Bun.file(`${dir}/package.json`).json()
    expect(pkg.name).toBe("@grist-ai/grist-skills")
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(pkg.license).toBe("MIT")
  })

  test("every file listed in files[] exists next to the manifest", async () => {
    const pkg = await Bun.file(`${dir}/package.json`).json()
    const files: string[] = pkg.files
    expect(files).toContain("SKILL.md")
    for (const file of files) {
      // LICENSE is staged from the repo root at publish time.
      if (file === "LICENSE") continue
      expect(await Bun.file(`${dir}/${file}`).exists()).toBe(true)
    }
  })

  test("SKILL.md carries the name/description frontmatter the skills CLI indexes", async () => {
    const text = await Bun.file(`${dir}/SKILL.md`).text()
    const match = text.match(/^---\n([\s\S]*?)\n---/)
    expect(match).not.toBeNull()
    const frontmatter = match?.[1] ?? ""
    expect(frontmatter).toMatch(/^name: grist$/m)
    expect(frontmatter).toMatch(/^description: .+/m)
  })
})
