import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { env } from "../../env.ts"

const mocks = vi.hoisted(() => ({
  listCodexModels: vi.fn(),
}))

vi.mock("./codex.ts", () => ({
  listCodexModels: mocks.listCodexModels,
  // status.ts pulls in the runner registry, which needs the codex runner.
  runCodex: vi.fn(),
}))

describe("getProviderStatuses", () => {
  let originalClaudeBinPath: string
  let originalCodexBinPath: string
  let originalCodexDefaultModel: string
  let originalOllamaApiKey: string | null
  let originalOllamaBaseUrl: string
  let originalOpenrouterApiKey: string | null
  let originalHuggingfaceApiKey: string | null
  let originalCerebrasApiKey: string | null

  beforeEach(() => {
    originalClaudeBinPath = env.claudeBinPath
    originalCodexBinPath = env.codexBinPath
    originalCodexDefaultModel = env.codexDefaultModel
    originalOllamaApiKey = env.ollamaApiKey
    originalOllamaBaseUrl = env.ollamaBaseUrl
    originalOpenrouterApiKey = env.openrouterApiKey
    originalHuggingfaceApiKey = env.huggingfaceApiKey
    originalCerebrasApiKey = env.cerebrasApiKey
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
    env.openrouterApiKey = originalOpenrouterApiKey
    env.huggingfaceApiKey = originalHuggingfaceApiKey
    env.cerebrasApiKey = originalCerebrasApiKey
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

  it("reports OpenRouter/Hugging Face/Cerebras with key-driven availability and fallback catalogs", async () => {
    env.openrouterApiKey = null
    env.huggingfaceApiKey = "hf-token"
    env.cerebrasApiKey = null
    mocks.listCodexModels.mockResolvedValue([])

    const { getProviderStatuses } = await import("./status.ts")
    const statuses = await getProviderStatuses()
    const byProvider = new Map(statuses.map((s) => [s.provider, s]))

    const openrouter = byProvider.get("openrouter")
    expect(openrouter?.available).toBe(false)
    expect(openrouter?.configHint).toMatch(/openrouter/i)
    expect(openrouter?.models).toContain(env.openrouterDefaultModel)

    const huggingface = byProvider.get("huggingface")
    expect(huggingface?.available).toBe(true)
    expect(huggingface?.configHint).toBeNull()
    expect(huggingface?.models).toContain(env.huggingfaceDefaultModel)

    const cerebras = byProvider.get("cerebras")
    expect(cerebras?.available).toBe(false)
    expect(cerebras?.models).toContain(env.cerebrasDefaultModel)
  })

  it("unconfiguredProviders returns only providers that aren't set up, deduped", async () => {
    env.huggingfaceApiKey = "hf-token"
    env.openrouterApiKey = null

    const { unconfiguredProviders } = await import("./status.ts")
    expect(
      unconfiguredProviders(["huggingface", "openrouter", "openrouter", "claude"]),
    ).toEqual(["openrouter", "claude"]) // claude bin path is bogus in this suite
  })
})

function response(models: string[]) {
  return {
    ok: true,
    json: async () => ({ models: models.map((name) => ({ name })) }),
  } as Response
}
