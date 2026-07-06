import type { StepUsage } from "@shared/types.ts"
import { env } from "../../env.ts"

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

const CEREBRAS_PRICES: Record<string, TokenPrice> = {
  // Snapshot from cerebras.ai/pricing + artificialanalysis.ai/providers/cerebras,
  // 2026-07-05. Cerebras' API exposes no pricing, so this is hand-maintained.
  "gpt-oss-120b": { inputPerMillion: 0.35, outputPerMillion: 0.75 },
  "llama-3.3-70b": { inputPerMillion: 0.85, outputPerMillion: 1.2 },
  "llama3.1-8b": { inputPerMillion: 0.1, outputPerMillion: 0.1 },
  "qwen-3-32b": { inputPerMillion: 0.4, outputPerMillion: 0.8 },
  "qwen-3-235b-a22b-instruct-2507": { inputPerMillion: 0.6, outputPerMillion: 1.2 },
  "qwen-3-coder-480b": { inputPerMillion: 2, outputPerMillion: 2 },
  "zai-glm-4.6": { inputPerMillion: 2.25, outputPerMillion: 2.75 },
  "zai-glm-4.7": { inputPerMillion: 2.25, outputPerMillion: 2.75 },
  "gemma-4-31b": { inputPerMillion: 0.99, outputPerMillion: 1.49 },
}

export function estimateCerebrasCostUsd(model: string, usage: StepUsage | null): number | undefined {
  if (!usage) return undefined
  const price = CEREBRAS_PRICES[model.trim().toLowerCase()]
  return price ? tokenCostUsd(usage, price) : undefined
}

type PriceCatalog = Map<string, TokenPrice>

/**
 * Cost estimator backed by a provider's live model catalog (OpenRouter and the
 * Hugging Face router both publish per-model pricing on their /models
 * endpoints). The catalog is cached for an hour; a failed refresh keeps
 * serving the stale copy.
 */
export function makeCatalogCostEstimator(
  fetchCatalog: () => Promise<PriceCatalog>,
  ttlMs = 60 * 60 * 1000,
): (model: string, usage: StepUsage | null) => Promise<number | undefined> {
  let catalog: PriceCatalog | null = null
  let fetchedAt = 0
  let inflight: Promise<void> | null = null

  return async (model, usage) => {
    if (!usage) return undefined
    if (!catalog || Date.now() - fetchedAt > ttlMs) {
      inflight ??= fetchCatalog()
        .then((next) => {
          catalog = next
          fetchedAt = Date.now()
        })
        .catch(() => {
          // Keep the stale catalog (or none); retry on the next estimate.
          fetchedAt = Date.now()
        })
        .finally(() => {
          inflight = null
        })
      await inflight
    }
    const price = catalog?.get(model.trim().toLowerCase())
    return price ? tokenCostUsd(usage, price) : undefined
  }
}

async function fetchProviderModels(baseUrl: string): Promise<Array<Record<string, unknown>>> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`models listing failed: ${res.status}`)
    const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
    return data.data ?? []
  } finally {
    clearTimeout(t)
  }
}

function asPositiveNumber(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** OpenRouter's catalog prices are USD per single token, as strings. */
async function fetchOpenRouterCatalog(): Promise<PriceCatalog> {
  const catalog: PriceCatalog = new Map()
  for (const m of await fetchProviderModels(env.openrouterBaseUrl)) {
    const id = typeof m.id === "string" ? m.id.toLowerCase() : ""
    const pricing = m.pricing as Record<string, unknown> | undefined
    const perMillion = (v: unknown) => {
      const n = asPositiveNumber(v)
      return n === undefined ? undefined : n * 1_000_000
    }
    const inputPerMillion = perMillion(pricing?.prompt)
    const outputPerMillion = perMillion(pricing?.completion)
    if (!id || inputPerMillion === undefined || outputPerMillion === undefined) continue
    catalog.set(id, { inputPerMillion, cachedInputPerMillion: perMillion(pricing?.input_cache_read), outputPerMillion })
  }
  return catalog
}

/**
 * The Hugging Face router lists each model's upstream providers with USD
 * per-million pricing. Requests route to one of them; the first live provider
 * prices the bare model id, and every provider is also keyed explicitly so
 * `model:provider` ids match exactly.
 */
async function fetchHuggingFaceCatalog(): Promise<PriceCatalog> {
  const catalog: PriceCatalog = new Map()
  for (const m of await fetchProviderModels(env.huggingfaceBaseUrl)) {
    const id = typeof m.id === "string" ? m.id.toLowerCase() : ""
    if (!id) continue
    const providers = Array.isArray(m.providers) ? (m.providers as Array<Record<string, unknown>>) : []
    for (const p of providers) {
      const pricing = p.pricing as Record<string, unknown> | undefined
      const inputPerMillion = asPositiveNumber(pricing?.input)
      const outputPerMillion = asPositiveNumber(pricing?.output)
      if (inputPerMillion === undefined || outputPerMillion === undefined) continue
      const price = { inputPerMillion, outputPerMillion }
      if (typeof p.provider === "string") catalog.set(`${id}:${p.provider.toLowerCase()}`, price)
      if (!catalog.has(id) && p.status === "live") catalog.set(id, price)
    }
  }
  return catalog
}

export const estimateOpenRouterCostUsd = makeCatalogCostEstimator(fetchOpenRouterCatalog)
export const estimateHuggingFaceCostUsd = makeCatalogCostEstimator(fetchHuggingFaceCatalog)
