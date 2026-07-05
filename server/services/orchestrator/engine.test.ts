import { describe, expect, it } from "vitest"
import type { FlowConfig, FlowStep, Provider } from "@shared/types.ts"
import type { ProviderRunner } from "../providers/types.ts"
import { resolveFlowSteps, runFlow } from "./engine.ts"

function step(id: string, provider: Provider = "ollama"): FlowStep {
  return {
    id,
    name: id,
    provider,
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
  }
}

function flow(steps: FlowStep[]): FlowConfig {
  return {
    id: "f",
    name: "f",
    description: "",
    steps,
    isBuiltin: false,
    createdAt: "",
    updatedAt: "",
  }
}

describe("resolveFlowSteps", () => {
  it("preserves step order", () => {
    const result = resolveFlowSteps(flow([step("a", "claude"), step("b", "ollama"), step("c", "codex")]))
    expect(result.map((s) => s.id)).toEqual(["a", "b", "c"])
  })

  it("de-duplicates repeated step ids, keeping the first occurrence", () => {
    const result = resolveFlowSteps(flow([step("a"), step("b"), step("a"), step("c")]))
    expect(result.map((s) => s.id)).toEqual(["a", "b", "c"])
  })

  it("drops steps without an id", () => {
    const result = resolveFlowSteps(flow([step("a"), { ...step(""), name: "noid" }, step("c")]))
    expect(result.map((s) => s.id)).toEqual(["a", "c"])
  })

  it("returns an empty array for a flow with no steps", () => {
    expect(resolveFlowSteps(flow([]))).toEqual([])
  })
})

describe("role step directives", () => {
  it("prepends an imperative role directive to the step prompt", async () => {
    const prompts: string[] = []
    const runners: Partial<Record<Provider, ProviderRunner>> = {
      codex: async (input) => {
        prompts.push(input.prompt)
        return { text: "the plan", usage: null }
      },
    }

    await runFlow({
      flow: flow([{ ...step("plan", "codex"), role: "planner" }]),
      repoPath: "/repo",
      repoName: "repo",
      designWorkspace: "/designs/p1",
      task: "Implement dark mode",
      history: "",
      emit: () => {},
      signal: new AbortController().signal,
      runners,
    })

    expect(prompts).toHaveLength(1)
    expect(prompts[0].startsWith("# Your job in this step\nYou are the PLANNER step")).toBe(true)
    expect(prompts[0]).toContain("must NOT implement")
    expect(prompts[0]).toContain("# Your task\nImplement dark mode")
  })

  // Legacy support: ui-designer no longer ships in builtin flows (it lives in
  // Product Design sessions), but user-edited flows carrying the role keep the
  // workspace special-case so they stay functional.
  it("gives legacy designer steps the app-internal design workspace and a read-only repo", async () => {
    const inputs: { prompt: string; workspaceDir?: string }[] = []
    const runners: Partial<Record<Provider, ProviderRunner>> = {
      claude: async (input) => {
        inputs.push({ prompt: input.prompt, workspaceDir: input.workspaceDir })
        return { text: "the prototype", usage: null }
      },
    }

    await runFlow({
      flow: flow([{ ...step("design", "claude"), role: "ui-designer" }]),
      repoPath: "/repo",
      repoName: "repo",
      designWorkspace: "/designs/p1",
      task: "Design the kanban board",
      history: "",
      emit: () => {},
      signal: new AbortController().signal,
      runners,
    })

    expect(inputs).toHaveLength(1)
    expect(inputs[0].workspaceDir).toBe("/designs/p1")
    expect(inputs[0].prompt).toContain("Your design workspace is /designs/p1")
    expect(inputs[0].prompt).toContain("strictly read-only")
    // The generic full-write repository context must not leak into designer steps.
    expect(inputs[0].prompt).not.toContain("full access to read, modify, create")
  })

  it("adds no directive for a custom (role-less) step", async () => {
    const prompts: string[] = []
    const runners: Partial<Record<Provider, ProviderRunner>> = {
      codex: async (input) => {
        prompts.push(input.prompt)
        return { text: "ok", usage: null }
      },
    }

    await runFlow({
      flow: flow([step("custom", "codex")]),
      repoPath: "/repo",
      repoName: "repo",
      designWorkspace: "/designs/p1",
      task: "Do the thing",
      history: "",
      emit: () => {},
      signal: new AbortController().signal,
      runners,
    })

    expect(prompts[0]).not.toContain("# Your job in this step")
  })

  it("passes uploadsDir through to the runner", async () => {
    const uploads: Array<string | undefined> = []
    const runners: Partial<Record<Provider, ProviderRunner>> = {
      codex: async (input) => {
        uploads.push(input.uploadsDir)
        return { text: "done", usage: null }
      },
    }

    await runFlow({
      flow: flow([step("code", "codex")]),
      repoPath: "/repo",
      repoName: "repo",
      designWorkspace: "/designs/p1",
      uploadsDir: "/uploads/p1/thread-1",
      task: "Do the thing",
      history: "",
      emit: () => {},
      signal: new AbortController().signal,
      runners,
    })

    expect(uploads).toEqual(["/uploads/p1/thread-1"])
  })
})

describe("plan-executor mode", () => {
  it("passes uploadsDir through plan-executor build and completion-check runner calls", async () => {
    const uploads: Array<string | undefined> = []
    const runners: Partial<Record<Provider, ProviderRunner>> = {
      codex: async (input) => {
        uploads.push(input.uploadsDir)
        if (input.prompt.includes("Inspect the repository")) {
          return {
            text: planJson("done", []),
            usage: null,
          }
        }
        return { text: "DONE: completed", usage: null }
      },
    }

    await runFlow({
      flow: flow([{ ...step("build", "codex"), mode: "plan-executor" }]),
      repoPath: "/repo",
      repoName: "repo",
      designWorkspace: "/designs/p1",
      uploadsDir: "/uploads/p1/thread-1",
      task: planJson("Build the feature", [{ id: 1, title: "Read file", prompt: "Inspect repository." }]),
      history: "",
      emit: () => {},
      signal: new AbortController().signal,
      runners,
    })

    expect(uploads).toEqual(["/uploads/p1/thread-1", "/uploads/p1/thread-1"])
  })

  it("runs each parsed plan step with fresh focused prompts", async () => {
    const buildPrompts: string[] = []
    const checkerPrompts: string[] = []
    const runners: Partial<Record<Provider, ProviderRunner>> = {
      claude: async () => ({
        text: planJson("Build the feature", [
          { id: 1, title: "Add API", prompt: "Create the API." },
          { id: 2, title: "Add UI", prompt: "Create the UI." },
          { id: 3, title: "Add tests", prompt: "Create tests." },
        ]),
        usage: null,
      }),
      codex: async (input) => {
        if (input.prompt.includes("Inspect the repository")) {
          checkerPrompts.push(input.prompt)
          return { text: planJson("done", []), usage: null }
        }
        buildPrompts.push(input.prompt)
        return { text: "DONE: completed focused step", usage: null }
      },
    }

    await runFlow({
      flow: flow([step("plan", "claude"), { ...step("build", "codex"), mode: "plan-executor" }]),
      repoPath: "/repo",
      repoName: "repo",
      designWorkspace: "/designs/p1",
      task: "Implement it",
      history: "User: old unrelated transcript",
      emit: () => {},
      signal: new AbortController().signal,
      runners,
    })

    expect(buildPrompts).toHaveLength(3)
    expect(checkerPrompts).toHaveLength(1)
    expect(buildPrompts[0]).toContain("# Big picture\nBuild the feature")
    expect(buildPrompts[0]).toContain("# Your task — step 1: Add API")
    expect(buildPrompts[1]).toContain("1. completed focused step")
    expect(buildPrompts.join("\n")).not.toContain("old unrelated transcript")
    expect(buildPrompts.join("\n")).not.toContain("Work already done by earlier agents")
  })

  it("reruns checker-reported missing steps and stops when complete", async () => {
    const built: string[] = []
    let checks = 0
    const runners: Partial<Record<Provider, ProviderRunner>> = {
      claude: async () => ({
        text: planJson("Build the feature", [
          { id: 1, title: "Add API", prompt: "Create the API." },
          { id: 2, title: "Add UI", prompt: "Create the UI." },
        ]),
        usage: null,
      }),
      codex: async (input) => {
        if (input.prompt.includes("Inspect the repository")) {
          checks += 1
          return {
            text:
              checks === 1
                ? planJson("missing", [{ id: 3, title: "Fix UI", prompt: "Finish the UI." }])
                : planJson("done", []),
            usage: null,
          }
        }
        built.push(input.prompt)
        return { text: `DONE: build ${built.length}`, usage: null }
      },
    }

    const result = await runFlow({
      flow: flow([step("plan", "claude"), { ...step("build", "codex"), mode: "plan-executor" }]),
      repoPath: "/repo",
      repoName: "repo",
      designWorkspace: "/designs/p1",
      task: "Implement it",
      history: "",
      emit: () => {},
      signal: new AbortController().signal,
      runners,
    })

    expect(built).toHaveLength(3)
    expect(checks).toBe(2)
    expect(result).toContain("build 3")
  })

  it("terminates on the completion-pass ceiling", async () => {
    const runners: Partial<Record<Provider, ProviderRunner>> = {
      claude: async () => ({
        text: planJson("Build the feature", [{ id: 1, title: "Add API", prompt: "Create the API." }]),
        usage: null,
      }),
      codex: async (input) => ({
        text: input.prompt.includes("Inspect the repository")
          ? planJson("missing", [{ id: 2, title: "Still missing", prompt: "Keep fixing." }])
          : "DONE: attempted",
        usage: null,
      }),
    }

    const result = await runFlow({
      flow: flow([
        step("plan", "claude"),
        { ...step("build", "codex"), mode: "plan-executor", maxCompletionPasses: 1 },
      ]),
      repoPath: "/repo",
      repoName: "repo",
      designWorkspace: "/designs/p1",
      task: "Implement it",
      history: "",
      emit: () => {},
      signal: new AbortController().signal,
      runners,
    })

    expect(result).toContain("Reached the completion-pass safety ceiling (1).")
  })
})

function planJson(summary: string, steps: Array<{ id: number; title: string; prompt: string }>): string {
  return `\`\`\`plan-json
${JSON.stringify({ summary, steps })}
\`\`\``
}
