import { afterEach, describe, expect, it, vi } from "vitest"
import { openAICompatibleAdapter, type OpenAICompatibleOptions } from "./openaiCompatible.ts"

function makeAdapter(overrides: Partial<OpenAICompatibleOptions> = {}) {
  return openAICompatibleAdapter({
    provider: "openrouter",
    label: "Test Provider",
    baseUrl: () => "https://api.test/v1",
    apiKey: () => "test-key",
    defaultModel: () => "fallback-b",
    fallbackModels: ["fallback-b", "fallback-a"],
    setupHint: "Add a key.",
    ...overrides,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("openAICompatibleAdapter", () => {
  it("is configured exactly when an API key is present", () => {
    expect(makeAdapter().isConfigured()).toBe(true)
    expect(makeAdapter().configHint()).toBeNull()

    const unset = makeAdapter({ apiKey: () => null })
    expect(unset.isConfigured()).toBe(false)
    expect(unset.configHint()).toBe("Add a key.")
    expect(unset.detail()).toBe("No API key configured")
  })

  it("merges live models with fallbacks, applying the model filter, sorted and deduped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            { id: "live-tools", supported_parameters: ["tools"] },
            { id: "live-no-tools", supported_parameters: [] },
            { id: "fallback-a", supported_parameters: ["tools"] },
          ],
        }),
      })),
    )
    const adapter = makeAdapter({
      modelFilter: (m) => Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools"),
    })
    expect(await adapter.listModels()).toEqual(["fallback-a", "fallback-b", "live-tools"])
  })

  it("skips the live listing (fallbacks only) when the listing needs a key and none is set", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const adapter = makeAdapter({ apiKey: () => null, listRequiresKey: true })
    expect(await adapter.listModels()).toEqual(["fallback-a", "fallback-b"])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("falls back to the static catalog when the live listing fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as Response))
    expect(await makeAdapter().listModels()).toEqual(["fallback-a", "fallback-b"])
  })

  it("clamps reasoning effort to the OpenAI-compatible ceiling and omits it by default", () => {
    const adapter = makeAdapter()
    const maxed = adapter.makeChatModel({ model: "m", temperature: null, effort: "max" }) as unknown as {
      modelKwargs?: Record<string, unknown>
    }
    expect(maxed.modelKwargs?.reasoning_effort).toBe("high")

    const plain = adapter.makeChatModel({ model: "m", temperature: null, effort: null }) as unknown as {
      modelKwargs?: Record<string, unknown>
    }
    expect(plain.modelKwargs?.reasoning_effort).toBeUndefined()
  })
})
