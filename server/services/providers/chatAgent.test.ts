import { AIMessageChunk } from "@langchain/core/messages"
import { describe, expect, it, vi } from "vitest"
import { runChatAgent } from "./chatAgent.ts"
import type { ChatProviderAdapter, ProviderRunInput } from "./types.ts"

function fakeAdapter(streamImpl: (effort: unknown) => AsyncIterable<AIMessageChunk>): {
  adapter: ChatProviderAdapter
  makeChatModel: ReturnType<typeof vi.fn>
} {
  const makeChatModel = vi.fn(({ effort }: { effort: unknown }) => ({
    bindTools: () => ({
      stream: async () => streamImpl(effort),
    }),
  }))
  return {
    adapter: {
      provider: "cerebras",
      label: "Fake",
      isConfigured: () => true,
      detail: () => "",
      configHint: () => null,
      defaultModel: () => "fake-model",
      listModels: async () => [],
      makeChatModel,
    } as unknown as ChatProviderAdapter,
    makeChatModel,
  }
}

function runInput(overrides: Partial<ProviderRunInput> = {}): ProviderRunInput {
  return {
    prompt: "do the thing",
    system: "",
    model: "fake-model",
    effort: "high",
    fast: false,
    cwd: "/tmp",
    maxIterations: 5,
    temperature: null,
    signal: new AbortController().signal,
    ...overrides,
  }
}

async function* chunks(text: string) {
  yield new AIMessageChunk({ content: text })
}

describe("runChatAgent effort handling", () => {
  it("drops the reasoning effort and retries when the model rejects the parameter", async () => {
    const logs: string[] = []
    const { adapter, makeChatModel } = fakeAdapter((effort) => {
      if (effort) throw new Error("400 unsupported parameter: 'reasoning_effort'")
      return chunks("done without effort")
    })

    const result = await runChatAgent(adapter, runInput({ onLog: (l) => logs.push(l) }))

    expect(result.text).toBe("done without effort")
    expect(makeChatModel).toHaveBeenCalledTimes(2)
    expect(makeChatModel.mock.calls[0][0].effort).toBe("high")
    expect(makeChatModel.mock.calls[1][0].effort).toBeNull()
    expect(logs.join("\n")).toMatch(/reasoning effort/i)
  })

  it("rethrows unrelated provider errors instead of silently retrying", async () => {
    const { adapter } = fakeAdapter(() => {
      throw new Error("401 invalid api key")
    })
    await expect(runChatAgent(adapter, runInput())).rejects.toThrow(/invalid api key/)
  })
})
