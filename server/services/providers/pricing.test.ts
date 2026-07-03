import { describe, expect, it } from "vitest"
import { estimateCodexCostUsd, estimateOllamaCostUsd } from "./pricing.ts"

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
