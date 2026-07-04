import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ROLE_IDS, type Provider } from "@shared/types.ts"
import { ROLE_SKILLS, resolveRolePrompt, roleSkillDirs } from "./index.ts"
import { effectiveSystemPrompt } from "../orchestrator/engine.ts"
import type { FlowStep } from "@shared/types.ts"

const PROVIDERS: Provider[] = ["claude", "codex", "ollama"]

function step(over: Partial<FlowStep>): FlowStep {
  return {
    id: "s",
    name: "s",
    provider: "claude",
    model: "m",
    effort: null,
    fast: false,
    role: "",
    systemPrompt: "",
    maxIterations: 5,
    temperature: null,
    mode: "single",
    maxCompletionPasses: 10,
    loop: null,
    ...over,
  }
}

describe("resolveRolePrompt", () => {
  it("exposes the seven expected roles", () => {
    expect(ROLE_IDS).toEqual([
      "coder",
      "planner",
      "heavy-planner",
      "reviewer",
      "product-specialist",
      "distributed-systems-architect",
      "ui-designer",
    ])
  })

  it("resolves every role on every provider to a substantial prompt", () => {
    for (const role of ROLE_IDS) {
      for (const provider of PROVIDERS) {
        const prompt = resolveRolePrompt(role, provider)
        expect(prompt.length, `${role}/${provider}`).toBeGreaterThan(2000)
      }
    }
  })

  it("uses the Claude pack prompt for Claude", () => {
    const p = resolveRolePrompt("coder", "claude")
    expect(p).toContain("You are Claude Code")
    expect(p).toContain("<coder_role>")
  })

  it("uses the Codex pack prompt for Codex", () => {
    const p = resolveRolePrompt("reviewer", "codex")
    expect(p).toContain("You are Codex")
    expect(p).toContain("<reviewer_role>")
  })

  it("adapts an Ollama variant: own identity, role body, no foreign identity claims", () => {
    const p = resolveRolePrompt("coder", "ollama")
    // The Ollama runtime preamble leads.
    expect(p).toContain("autonomous software-engineering agent")
    expect(p).toContain("read_file")
    expect(p).toContain("bash(command")
    expect(p).toContain("git, package managers, compilers, test runners")
    expect(p).not.toContain("You have no shell")
    // The role body is reused.
    expect(p).toContain("<coder_role>")
    expect(p).toContain("<operating_rules>")
    // Claude's identity header is stripped, not fed to Ollama.
    expect(p).not.toContain("You are Claude Code")
  })

  it("returns empty for an empty or unknown role (callers fall back to custom)", () => {
    expect(resolveRolePrompt("", "claude")).toBe("")
    expect(resolveRolePrompt("not-a-role", "claude")).toBe("")
  })

  it("resolves the heavy planner with its deeper planning contract", () => {
    const p = resolveRolePrompt("heavy-planner", "claude")
    expect(p).toContain("<heavy_planner_role>")
    expect(p).toContain("Blast Radius")
    expect(p).toContain("Architecture fit")
    expect(p).toContain("Edge cases")
    expect(p).toContain("smaller model")
    // Meaningfully more thorough than the standard planner.
    expect(p.length).toBeGreaterThan(resolveRolePrompt("planner", "claude").length * 1.5)
  })

  it("resolves the UI designer with its prototype contract", () => {
    const p = resolveRolePrompt("ui-designer", "claude")
    expect(p).toContain("<ui_designer_role>")
    expect(p).toContain("design workspace")
    expect(p).toContain("index.html")
    expect(p).toContain("No JavaScript")
    expect(p).toContain("tokens.css")
    expect(p).toContain("HANDOFF.md")
  })
})

describe("role skills", () => {
  it("assigns every role a skill package, and every skill file exists with frontmatter", () => {
    for (const role of ROLE_IDS) {
      const skills = ROLE_SKILLS[role]
      expect(skills?.length, role).toBeGreaterThan(0)
      for (const dir of roleSkillDirs(role)) {
        const file = join(dir, "SKILL.md")
        expect(existsSync(file), file).toBe(true)
        const text = readFileSync(file, "utf8")
        expect(text, file).toMatch(/^name:\s*\S+/m)
        expect(text, file).toMatch(/^description:\s*\S+/m)
      }
    }
  })

  it("returns no skill dirs for an empty or unknown role", () => {
    expect(roleSkillDirs("")).toEqual([])
    expect(roleSkillDirs("not-a-role")).toEqual([])
  })

  it("lists the role's skills in every provider prompt, adapted to the runtime", () => {
    for (const role of ROLE_IDS) {
      for (const provider of PROVIDERS) {
        const p = resolveRolePrompt(role, provider)
        expect(p, `${role}/${provider}`).toContain("<role_skills>")
        for (const skill of ROLE_SKILLS[role]) expect(p, `${role}/${provider}`).toContain(`- ${skill} — `)
      }
    }
    // Claude/Codex load skills by absolute file path; Ollama through its tools.
    const claude = resolveRolePrompt("coder", "claude")
    expect(claude).toContain(join("skills", "solid-design-principles", "SKILL.md"))
    const ollama = resolveRolePrompt("coder", "ollama")
    expect(ollama).toContain("read_skill")
    expect(ollama).not.toContain(join("skills", "solid-design-principles", "SKILL.md"))
  })
})

describe("effectiveSystemPrompt", () => {
  it("returns the role prompt when there are no extra instructions", () => {
    const s = step({ role: "coder", provider: "claude", systemPrompt: "" })
    expect(effectiveSystemPrompt(s)).toBe(resolveRolePrompt("coder", "claude"))
  })

  it("layers extra instructions on top of the role prompt", () => {
    const s = step({ role: "reviewer", provider: "codex", systemPrompt: "End with APPROVE or REVISE." })
    const out = effectiveSystemPrompt(s)
    expect(out).toContain("<reviewer_role>")
    expect(out).toContain("# Additional task-specific instructions")
    expect(out).toContain("End with APPROVE or REVISE.")
  })

  it("falls back to raw instructions for a custom (role-less) step", () => {
    const s = step({ role: "", systemPrompt: "Do the thing." })
    expect(effectiveSystemPrompt(s)).toBe("Do the thing.")
  })
})
