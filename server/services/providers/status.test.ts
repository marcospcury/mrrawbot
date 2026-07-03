import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { env } from "../../env.ts"

const mocks = vi.hoisted(() => ({
  listCodexModels: vi.fn(),
}))

vi.mock("./codex.ts", () => ({
  listCodexModels: mocks.listCodexModels,
}))

describe("getProviderStatuses", () => {
  let originalClaudeBinPath: string
  let originalCodexBinPath: string
  let originalCodexDefaultModel: string
  let originalOllamaApiKey: string | null
  let originalOllamaBaseUrl: string

  beforeEach(() => {
    originalClaudeBinPath = env.claudeBinPath
    originalCodexBinPath = env.codexBinPath
    originalCodexDefaultModel = env.codexDefaultModel
    originalOllamaApiKey = env.ollamaApiKey
    originalOllamaBaseUrl = env.ollamaBaseUrl
    env.claudeBinPath = "/definitely/not/claude"
    env.codexBinPath = "codex"
    env.codexDefaultModel = "gpt-default"
    mocks.listCodexModels.mockReset()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const text = String(url)
        if (text.startsWith("https://ollama.test")) {
          return response(["cloud-model", "dupe-model"])
        }
        if (text.startsWith("http://localhost:11434")) throw new Error("local Ollama must not be queried")
        return response([])
      }),
    )
  })

  afterEach(() => {
    env.claudeBinPath = originalClaudeBinPath
    env.codexBinPath = originalCodexBinPath
    env.codexDefaultModel = originalCodexDefaultModel
    env.ollamaApiKey = originalOllamaApiKey
    env.ollamaBaseUrl = originalOllamaBaseUrl
    vi.unstubAllGlobals()
  })

  it("keeps Codex hidden models in the catalog and marks them", async () => {
    mocks.listCodexModels.mockResolvedValue([
      { id: "visible-model", hidden: false, fastTier: "priority" },
      { id: "hidden-model", hidden: true, fastTier: null },
    ])

    const { getProviderStatuses } = await import("./status.ts")
    const codex = (await getProviderStatuses()).find((s) => s.provider === "codex")

    expect(codex?.models).toContain("visible-model")
    expect(codex?.models).toContain("hidden-model")
    expect(codex?.hiddenModels).toContain("hidden-model")
    expect(codex?.fastModels).toContain("visible-model")
  })

  it("merges and dedupes Ollama Cloud and fallback models only", async () => {
    env.ollamaApiKey = "key"
    env.ollamaBaseUrl = "https://ollama.test"
    mocks.listCodexModels.mockResolvedValue([])

    const { getProviderStatuses } = await import("./status.ts")
    const ollama = (await getProviderStatuses()).find((s) => s.provider === "ollama")

    expect(ollama?.models).toContain("cloud-model")
    expect(ollama?.models).not.toContain("local-model")
    expect(ollama?.models.filter((m) => m === "dupe-model")).toHaveLength(1)
    expect(ollama?.models).toContain("qwen3-coder:480b-cloud")
  })
})

function response(models: string[]) {
  return {
    ok: true,
    json: async () => ({ models: models.map((name) => ({ name })) }),
  } as Response
}
