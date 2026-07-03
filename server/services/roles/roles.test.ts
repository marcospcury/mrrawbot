import { describe, expect, it } from "vitest"
import { ROLE_IDS, type Provider } from "@shared/types.ts"
import { resolveRolePrompt } from "./index.ts"
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
  it("exposes the five expected roles", () => {
    expect(ROLE_IDS).toEqual([
      "coder",
      "planner",
      "reviewer",
      "product-specialist",
      "distributed-systems-architect",
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
