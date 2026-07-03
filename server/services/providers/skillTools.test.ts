import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { makeSkillTools } from "./skillTools.ts"

async function addSkill(root: string, name: string, frontmatter: string, body = "Do the thing.") {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}`, "utf8")
  return dir
}

describe("makeSkillTools", () => {
  let cwd: string

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), "skills-cwd-"))
    await addSkill(join(cwd, ".claude", "skills"), "deploy", "name: deploy\ndescription: Ship the app")
    await addSkill(join(cwd, ".codex", "skills"), "review", "name: review\ndescription: Review a PR")
    await writeFile(join(cwd, ".codex", "skills", "review", "checklist.md"), "- item", "utf8")
  })

  function tools(c = cwd) {
    const [list, read] = makeSkillTools(c)
    return { list, read }
  }

  it("lists skills from the repository's skill folders with source and description", async () => {
    const { list } = tools()
    const out = String(await list.invoke({}))
    expect(out).toContain("deploy [project] — Ship the app")
    expect(out).toContain("review [project] — Review a PR")
  })

  it("reads a skill's SKILL.md and lists its extra files", async () => {
    const { read } = tools()
    const out = String(await read.invoke({ name: "review" }))
    expect(out).toContain("Review a PR")
    expect(out).toContain("Do the thing.")
    expect(out).toContain("checklist.md")
  })

  it("returns available names for an unknown skill", async () => {
    const { read } = tools()
    const out = String(await read.invoke({ name: "nope" }))
    expect(out).toContain('no skill named "nope"')
    expect(out).toContain("deploy")
  })

  it("handles missing skill folders gracefully", async () => {
    const empty = await mkdtemp(join(tmpdir(), "skills-empty-"))
    const { list } = tools(empty)
    expect(String(await list.invoke({}))).toBe("(no skills found)")
  })
})
