import { describe, expect, it } from "vitest"
import { env } from "../env.ts"
import { generateThreadTitle, normalizeThreadTitle } from "./threadTitles.ts"

const hasOllama = Boolean(env.ollamaApiKey)

describe("thread title normalization", () => {
  it("extracts a concise plain title from common model wrappers", () => {
    expect(normalizeThreadTitle('{"title":"Auto Name Threads."}')).toBe("Auto Name Threads")
    expect(normalizeThreadTitle("```text\n- Fix Ollama Thread Naming\n```")).toBe("Fix Ollama Thread Naming")
    expect(normalizeThreadTitle("“Build Workspace Change Viewer!”")).toBe("Build Workspace Change Viewer")
  })

  it("trims very long titles at a word boundary", () => {
    const title = normalizeThreadTitle(
      "Implement Automatic Thread Naming With A Very Long Generated Title That Should Not Overflow The Sidebar",
    )

    expect(title.length).toBeLessThanOrEqual(70)
    expect(title).toBe("Implement Automatic Thread Naming With A Very Long Generated Title")
  })
})

;(hasOllama ? describe : describe.skip)("thread title generation (live)", () => {
  it(
    "generates a concise title from task, history, and assistant result in one Ollama shot",
    { timeout: 30_000 },
    async () => {
      const title = await generateThreadTitle({
        task: "Build a helper to retry failed API calls with exponential backoff.",
        history: "User: We have intermittent network failures when calling upstream APIs.",
        finalAnswer:
          "Added a small utility that wraps fetch with retry logic and configurable delays per attempt.",
        signal: new AbortController().signal,
      })

      expect(title.length).toBeGreaterThan(0)
      expect(title.length).toBeLessThanOrEqual(70)
    },
  )
})
