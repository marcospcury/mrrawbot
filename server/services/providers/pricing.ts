import type { StepUsage } from "@shared/types.ts"

type TokenPrice = {
  inputPerMillion: number
  cachedInputPerMillion?: number
  outputPerMillion: number
}

type CodexTier = "standard" | "flex" | "priority"
type TieredTokenPrice = { maxInputTokens?: number; price: TokenPrice }

const CODEX_PRICES: Record<CodexTier, Record<string, TokenPrice>> = {
  // Snapshot from OpenAI API pricing, 2026-07-02. Prices are USD per 1M tokens.
  standard: {
    "gpt-5.5": { inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 30 },
    "gpt-5.5-pro": { inputPerMillion: 30, outputPerMillion: 180 },
    "gpt-5.4": { inputPerMillion: 2.5, cachedInputPerMillion: 0.25, outputPerMillion: 15 },
    "gpt-5.4-mini": { inputPerMillion: 0.75, cachedInputPerMillion: 0.075, outputPerMillion: 4.5 },
    "gpt-5.4-nano": { inputPerMillion: 0.2, cachedInputPerMillion: 0.02, outputPerMillion: 1.25 },
    "gpt-5.4-pro": { inputPerMillion: 30, outputPerMillion: 180 },
    "gpt-5.3-codex": { inputPerMillion: 1.75, cachedInputPerMillion: 0.175, outputPerMillion: 14 },
  },
  flex: {
    "gpt-5.5": { inputPerMillion: 2.5, cachedInputPerMillion: 0.25, outputPerMillion: 15 },
    "gpt-5.5-pro": { inputPerMillion: 15, outputPerMillion: 90 },
    "gpt-5.4": { inputPerMillion: 1.25, cachedInputPerMillion: 0.13, outputPerMillion: 7.5 },
    "gpt-5.4-mini": { inputPerMillion: 0.375, cachedInputPerMillion: 0.0375, outputPerMillion: 2.25 },
    "gpt-5.4-nano": { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.625 },
    "gpt-5.4-pro": { inputPerMillion: 15, outputPerMillion: 90 },
  },
  priority: {
    "gpt-5.5": { inputPerMillion: 12.5, cachedInputPerMillion: 1.25, outputPerMillion: 75 },
    "gpt-5.4": { inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 30 },
    "gpt-5.4-mini": { inputPerMillion: 1.5, cachedInputPerMillion: 0.15, outputPerMillion: 9 },
    "gpt-5.3-codex": { inputPerMillion: 3.5, cachedInputPerMillion: 0.35, outputPerMillion: 28 },
  },
}

const OLLAMA_UPSTREAM_PRICES: Record<string, TokenPrice | TieredTokenPrice[]> = {
  // Snapshot from upstream model providers, 2026-07-02. Prices are USD per 1M tokens.
  // DeepSeek: api-docs.deepseek.com/quick_start/pricing
  "deepseek-v4-flash": { inputPerMillion: 0.14, cachedInputPerMillion: 0.0028, outputPerMillion: 0.28 },
  "deepseek-v4-pro": { inputPerMillion: 0.435, cachedInputPerMillion: 0.003625, outputPerMillion: 0.87 },

  // Google: ai.google.dev/gemini-api/docs/pricing
  "gemini-3-flash-preview": { inputPerMillion: 0.5, cachedInputPerMillion: 0.05, outputPerMillion: 3 },

  // Z.ai: docs.z.ai/guides/overview/pricing
  "glm-4.7": { inputPerMillion: 0.6, cachedInputPerMillion: 0.11, outputPerMillion: 2.2 },
  "glm-5": { inputPerMillion: 1, cachedInputPerMillion: 0.2, outputPerMillion: 3.2 },
  "glm-5.1": { inputPerMillion: 1.4, cachedInputPerMillion: 0.26, outputPerMillion: 4.4 },
  "glm-5.2": { inputPerMillion: 1.4, cachedInputPerMillion: 0.26, outputPerMillion: 4.4 },

  // Kimi/Moonshot: platform.kimi.ai/docs/pricing/chat-k25, chat-k26, chat-k27-code
  "kimi-k2.5": { inputPerMillion: 0.6, cachedInputPerMillion: 0.1, outputPerMillion: 3 },
  "kimi-k2.6": { inputPerMillion: 0.95, cachedInputPerMillion: 0.16, outputPerMillion: 4 },
  "kimi-k2.7-code": { inputPerMillion: 0.95, cachedInputPerMillion: 0.19, outputPerMillion: 4 },

  // MiniMax: platform.minimax.io/docs/guides/pricing-paygo
  "minimax-m2.1": { inputPerMillion: 0.3, cachedInputPerMillion: 0.03, outputPerMillion: 1.2 },
  "minimax-m2.5": { inputPerMillion: 0.3, cachedInputPerMillion: 0.03, outputPerMillion: 1.2 },
  "minimax-m2.7": { inputPerMillion: 0.3, cachedInputPerMillion: 0.06, outputPerMillion: 1.2 },
  "minimax-m3": [
    { maxInputTokens: 512_000, price: { inputPerMillion: 0.3, cachedInputPerMillion: 0.06, outputPerMillion: 1.2 } },
    { price: { inputPerMillion: 0.6, cachedInputPerMillion: 0.12, outputPerMillion: 2.4 } },
  ],

  // Mistral: docs.mistral.ai/models/model-selection-guide
  "mistral-large-3:675b": { inputPerMillion: 0.5, outputPerMillion: 1.5 },

  // Qwen/Alibaba: alibabacloud.com/help/en/model-studio/model-pricing
  "qwen3-coder-next": [
    { maxInputTokens: 32_000, price: { inputPerMillion: 0.3, outputPerMillion: 1.5 } },
    { maxInputTokens: 128_000, price: { inputPerMillion: 0.5, outputPerMillion: 2.5 } },
    { price: { inputPerMillion: 0.8, outputPerMillion: 4 } },
  ],
  "qwen3-coder:480b": [
    { maxInputTokens: 32_000, price: { inputPerMillion: 0.861, outputPerMillion: 3.441 } },
    { maxInputTokens: 128_000, price: { inputPerMillion: 1.291, outputPerMillion: 5.161 } },
    { price: { inputPerMillion: 2.151, outputPerMillion: 8.602 } },
  ],
  "qwen3.5:397b": [
    { maxInputTokens: 128_000, price: { inputPerMillion: 0.172, outputPerMillion: 1.032 } },
    { price: { inputPerMillion: 0.43, outputPerMillion: 2.58 } },
  ],
}

function codexTier(serviceTier?: string): CodexTier {
  if (serviceTier === "flex") return "flex"
  if (serviceTier === "priority" || serviceTier === "fast") return "priority"
  return "standard"
}

function codexPriceKey(model: string): string {
  if (model.startsWith("gpt-5.3-codex")) return "gpt-5.3-codex"
  return model
}

function tokenCostUsd(usage: StepUsage, price: TokenPrice): number | undefined {
  const inputTokens = usage.inputTokens ?? 0
  const cachedInputTokens = Math.min(usage.cachedInputTokens ?? 0, inputTokens)
  const uncachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0)
  const outputTokens = usage.outputTokens ?? 0
  if (inputTokens === 0 && outputTokens === 0) return undefined

  return (
    (uncachedInputTokens * price.inputPerMillion +
      cachedInputTokens * (price.cachedInputPerMillion ?? price.inputPerMillion) +
      outputTokens * price.outputPerMillion) /
    1_000_000
  )
}

export function estimateCodexCostUsd(model: string, usage: StepUsage | null, serviceTier?: string): number | undefined {
  if (!usage) return undefined
  const tier = codexTier(serviceTier)
  const price = CODEX_PRICES[tier][codexPriceKey(model)] ?? CODEX_PRICES.standard[codexPriceKey(model)]
  return price ? tokenCostUsd(usage, price) : undefined
}

function normalizeOllamaPriceKey(model: string): string {
  const key = model.trim().toLowerCase()
  if (key.endsWith(":cloud")) return key.slice(0, -":cloud".length)
  if (key.endsWith("-cloud")) return key.slice(0, -"-cloud".length)
  return key
}

function selectPrice(usage: StepUsage, price: TokenPrice | TieredTokenPrice[]): TokenPrice {
  if (!Array.isArray(price)) return price
  const inputTokens = usage.inputTokens ?? 0
  return price.find((tier) => tier.maxInputTokens === undefined || inputTokens <= tier.maxInputTokens)?.price ?? price[price.length - 1].price
}

export function estimateOllamaCostUsd(model: string, usage: StepUsage | null): number | undefined {
  if (!usage) return undefined
  const price = OLLAMA_UPSTREAM_PRICES[normalizeOllamaPriceKey(model)]
  return price ? tokenCostUsd(usage, selectPrice(usage, price)) : undefined
}
