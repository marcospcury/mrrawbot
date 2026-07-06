import { describe, expect, it } from "vitest"
import {
  estimateCerebrasCostUsd,
  estimateCodexCostUsd,
  estimateOllamaCostUsd,
  makeCatalogCostEstimator,
} from "./pricing.ts"

describe("estimateCodexCostUsd", () => {
  it("uses standard pricing and cached input discount", () => {
    expect(
      estimateCodexCostUsd("gpt-5.5", {
        inputTokens: 1_000_000,
        cachedInputTokens: 250_000,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo(6.875)
  })

  it("uses priority pricing for fast tier", () => {
    expect(
      estimateCodexCostUsd(
        "gpt-5.4-mini",
        {
          inputTokens: 1_000_000,
          cachedInputTokens: 500_000,
          outputTokens: 100_000,
        },
        "fast",
      ),
    ).toBeCloseTo(1.725)
  })

  it("falls back from codex model variants to the base codex price", () => {
    expect(
      estimateCodexCostUsd("gpt-5.3-codex-spark", {
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo(3.15)
  })
})

describe("estimateOllamaCostUsd", () => {
  it("uses upstream DeepSeek V4 pricing with cached input", () => {
    expect(
      estimateOllamaCostUsd("deepseek-v4-pro:cloud", {
        inputTokens: 1_000_000,
        cachedInputTokens: 100_000,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo(0.4788625)
  })

  it("uses upstream Z.ai pricing for GLM models", () => {
    expect(
      estimateOllamaCostUsd("glm-5.2:cloud", {
        inputTokens: 1_000_000,
        cachedInputTokens: 100_000,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo(1.726)
  })

  it("uses upstream Kimi pricing", () => {
    expect(
      estimateOllamaCostUsd("kimi-k2.7-code:cloud", {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo(1.35)
  })

  it("uses tiered upstream Qwen pricing", () => {
    expect(
      estimateOllamaCostUsd("qwen3-coder:480b-cloud", {
        inputTokens: 40_000,
        outputTokens: 1_000,
      }),
    ).toBeCloseTo(0.056801)
  })

  it("does not invent pricing for unsourced models", () => {
    expect(
      estimateOllamaCostUsd("nemotron-3-ultra:cloud", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeUndefined()
  })
})

describe("estimateCerebrasCostUsd", () => {
  it("uses the hand-maintained Cerebras snapshot", () => {
    expect(
      estimateCerebrasCostUsd("zai-glm-4.6", {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo(2.525)
  })

  it("does not invent pricing for unknown models", () => {
    expect(
      estimateCerebrasCostUsd("mystery-model", { inputTokens: 1_000, outputTokens: 1_000 }),
    ).toBeUndefined()
  })
})

describe("makeCatalogCostEstimator", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 100_000 }

  it("prices models from the fetched catalog and caches it", async () => {
    let fetches = 0
    const estimate = makeCatalogCostEstimator(async () => {
      fetches++
      return new Map([["vendor/model", { inputPerMillion: 2, outputPerMillion: 10 }]])
    })
    expect(await estimate("vendor/model", usage)).toBeCloseTo(3)
    expect(await estimate("Vendor/Model", usage)).toBeCloseTo(3)
    expect(await estimate("vendor/other", usage)).toBeUndefined()
    expect(fetches).toBe(1)
  })

  it("returns undefined while the catalog is unreachable", async () => {
    const estimate = makeCatalogCostEstimator(async () => {
      throw new Error("network down")
    })
    expect(await estimate("vendor/model", usage)).toBeUndefined()
  })
})
