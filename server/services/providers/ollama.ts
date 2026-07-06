import { ChatOllama } from "@langchain/ollama"
import type { Effort } from "@shared/types.ts"
import { env } from "../../env.ts"
import { makeChatAgentRunner } from "./chatAgent.ts"
import { estimateOllamaCostUsd } from "./pricing.ts"
import type { ChatProviderAdapter } from "./types.ts"

// Ollama "think": off for low effort, on for anything higher.
function ollamaThink(effort: Effort | null): boolean | undefined {
  if (!effort) return undefined
  return effort !== "low"
}

// Snapshot of https://ollama.com/api/tags (unauthenticated) taken 2026-06-30, with the
// `-cloud` / `:cloud` suffix Ollama Cloud expects.
const OLLAMA_FALLBACK_MODELS = [
  "deepseek-v3.1:671b-cloud",
  "deepseek-v3.2:cloud",
  "deepseek-v4-flash:cloud",
  "deepseek-v4-pro:cloud",
  "devstral-2:123b-cloud",
  "devstral-small-2:24b-cloud",
  "gemini-3-flash-preview:cloud",
  "gemma3:12b-cloud",
  "gemma3:27b-cloud",
  "gemma3:4b-cloud",
  "gemma4:31b-cloud",
  "glm-4.7:cloud",
  "glm-5.1:cloud",
  "glm-5.2:cloud",
  "glm-5:cloud",
  "gpt-oss:120b-cloud",
  "gpt-oss:20b-cloud",
  "kimi-k2.5:cloud",
  "kimi-k2.6:cloud",
  "kimi-k2.7-code:cloud",
  "minimax-m2.1:cloud",
  "minimax-m2.5:cloud",
  "minimax-m2.7:cloud",
  "minimax-m3:cloud",
  "ministral-3:14b-cloud",
  "ministral-3:3b-cloud",
  "ministral-3:8b-cloud",
  "mistral-large-3:675b-cloud",
  "nemotron-3-nano:30b-cloud",
  "nemotron-3-super:cloud",
  "nemotron-3-ultra:cloud",
  "qwen3-coder-next:cloud",
  "qwen3-coder:480b-cloud",
  "qwen3.5:397b-cloud",
  "rnj-1:8b-cloud",
]

async function fetchOllamaTags(ms: number): Promise<string[]> {
  if (!env.ollamaApiKey) return []
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    const res = await fetch(`${env.ollamaBaseUrl.replace(/\/+$/, "")}/api/tags`, {
      headers: { Authorization: `Bearer ${env.ollamaApiKey}` },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!res.ok) return []
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> }
    return (data.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean)
  } catch {
    return []
  }
}

export function makeOllama(model: string, temperature: number | null, think?: boolean) {
  const headers: Record<string, string> = {}
  if (env.ollamaApiKey) headers.Authorization = `Bearer ${env.ollamaApiKey}`
  return new ChatOllama({
    model: model || env.ollamaDefaultModel,
    baseUrl: env.ollamaBaseUrl,
    headers,
    temperature: temperature ?? undefined,
    ...(think !== undefined ? { think } : {}),
  })
}

export const ollamaAdapter: ChatProviderAdapter = {
  provider: "ollama",
  label: "Ollama Cloud",
  isConfigured: () => !!env.ollamaApiKey,
  detail: () => (env.ollamaApiKey ? `Ollama Cloud at ${env.ollamaBaseUrl}` : "No API key configured"),
  configHint: () =>
    env.ollamaApiKey ? null : "Add your Ollama Cloud API key in Settings (get one at ollama.com).",
  defaultModel: () => env.ollamaDefaultModel,
  listModels: async () => {
    const live = await fetchOllamaTags(5000)
    return Array.from(new Set([...live, ...OLLAMA_FALLBACK_MODELS])).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
    )
  },
  makeChatModel: ({ model, temperature, effort }) => makeOllama(model, temperature, ollamaThink(effort)),
  estimateCostUsd: estimateOllamaCostUsd,
}

/** Ollama Cloud agent on the shared LangChain tool-calling loop. */
export const runOllama = makeChatAgentRunner(ollamaAdapter)
