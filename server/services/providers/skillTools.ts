import { readdir, readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { tool, type StructuredToolInterface } from "@langchain/core/tools"
import { z } from "zod"

const MAX_OUTPUT = 16_000

function clip(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…[truncated ${s.length - MAX_OUTPUT} chars]` : s
}

interface Skill {
  name: string
  description: string
  dir: string
  source: string
}

/** Read one skill folder (a directory holding a SKILL.md); null when absent. */
async function readSkillDir(dir: string, source: string): Promise<Skill | null> {
  let text: string
  try {
    text = await readFile(join(dir, "SKILL.md"), "utf8")
  } catch {
    return null
  }
  const fm = parseFrontmatter(text)
  return { name: fm.name ?? basename(dir), description: fm.description ?? "", dir, source }
}

/** Pull name/description out of SKILL.md YAML frontmatter (best-effort). */
function parseFrontmatter(text: string): { name?: string; description?: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const out: { name?: string; description?: string } = {}
  const name = m[1].match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const description = m[1].match(/^description:\s*(.+)$/m)?.[1]?.trim()
  if (name) out.name = name
  if (description) out.description = description
  return out
}

/**
 * Discover the skills available to a run: the role's bundled skill folders
 * (shipped with the app, passed in by the orchestrator) plus repository skills
 * from `<repo>/.claude/skills` and `<repo>/.codex/skills`, each skill a
 * `<name>/SKILL.md` folder. The user's `~/.claude` / `~/.codex` homes are
 * deliberately NOT scanned — agents in this harness run fresh and must never
 * inherit the user's external setup.
 */
async function discoverSkills(cwd: string, roleSkillDirs: string[]): Promise<Skill[]> {
  const byName = new Map<string, Skill>()
  // Role skills first: they are harness-owned and win name collisions.
  for (const dir of roleSkillDirs) {
    const skill = await readSkillDir(dir, "role")
    if (skill && !byName.has(skill.name)) byName.set(skill.name, skill)
  }
  const roots = [
    { dir: join(cwd, ".claude", "skills"), source: "project" },
    { dir: join(cwd, ".codex", "skills"), source: "project" },
  ]
  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue
      const skill = await readSkillDir(join(root.dir, e.name), root.source)
      if (skill && !byName.has(skill.name)) byName.set(skill.name, skill)
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Tools that let the Ollama agent loop discover and load skills. */
export function makeSkillTools(cwd: string, roleSkillDirs: string[] = []): StructuredToolInterface[] {
  const listSkillsTool = tool(
    async () => {
      const skills = await discoverSkills(cwd, roleSkillDirs)
      if (skills.length === 0) return "(no skills found)"
      return clip(skills.map((s) => `${s.name} [${s.source}] — ${s.description || "(no description)"}`).join("\n"))
    },
    {
      name: "list_skills",
      description:
        "List the skills available for this task: reusable, task-specific instructions the user has installed. Each line is `name [source] — description`. Call this before starting any non-trivial task; if a skill matches, load it with read_skill.",
      schema: z.object({}),
    },
  )

  const readSkillTool = tool(
    async ({ name }) => {
      const skills = await discoverSkills(cwd, roleSkillDirs)
      const skill = skills.find((s) => s.name === name) ?? skills.find((s) => s.name.toLowerCase() === name.toLowerCase())
      if (!skill) {
        const available = skills.map((s) => s.name).join(", ") || "(none)"
        return `Error: no skill named "${name}". Available: ${available}`
      }
      let text: string
      try {
        text = await readFile(join(skill.dir, "SKILL.md"), "utf8")
      } catch (e) {
        return `Error: ${(e as Error).message}`
      }
      let extras: string[] = []
      try {
        extras = (await readdir(skill.dir)).filter((f) => f !== "SKILL.md")
      } catch {
        /* ignore */
      }
      const header = `Skill folder: ${skill.dir}${extras.length ? `\nOther files (read with bash, e.g. \`cat '${skill.dir}/<file>'\`): ${extras.join(", ")}` : ""}`
      return clip(`${header}\n\n${text}`)
    },
    {
      name: "read_skill",
      description:
        "Load a skill by name (as listed by list_skills) and return its full SKILL.md instructions. Follow the loaded instructions for the task instead of improvising.",
      schema: z.object({ name: z.string().describe("Skill name exactly as listed by list_skills") }),
    },
  )

  return [listSkillsTool, readSkillTool]
}
