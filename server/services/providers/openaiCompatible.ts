import { ChatOpenAI } from "@langchain/openai"
import type { Effort, Provider } from "@shared/types.ts"
import type { ChatModelOptions, ChatProviderAdapter, ToolCallingChatModel } from "./types.ts"

/**
 * Adapter factory for providers exposing an OpenAI-compatible chat completions
 * API (OpenRouter, Hugging Face router, Cerebras, ...). Config accessors are
 * closures because API keys live on the mutable `env` object (Settings edits
 * update it at runtime).
 */
export interface OpenAICompatibleOptions {
  provider: Provider
  label: string
  baseUrl: () => string
  apiKey: () => string | null
  defaultModel: () => string
  /** Static catalog used when the live listing is unreachable, merged in always. */
  fallbackModels: string[]
  /** Setup instruction shown while no API key is configured. */
  setupHint: string
  /** Extra HTTP headers sent with every chat request. */
  defaultHeaders?: Record<string, string>
  /** Keep only live-listed models the agent loop can actually drive (tool support). */
  modelFilter?: (entry: Record<string, unknown>) => boolean
  /** Whether the /models listing requires the API key (e.g. Cerebras). */
  listRequiresKey?: boolean
  /** Cost estimation attached to normalized usage (static table or cached live catalog). */
  estimateCostUsd?: ChatProviderAdapter["estimateCostUsd"]
}

/** These providers accept OpenAI's `reasoning_effort`, which tops out at "high". */
function clampEffort(effort: Effort | null): "low" | "medium" | "high" | null {
  if (!effort) return null
  return effort === "xhigh" || effort === "max" ? "high" : effort
}

async function fetchModelIds(
  url: string,
  headers: Record<string, string>,
  filter: ((entry: Record<string, unknown>) => boolean) | undefined,
  ms: number,
): Promise<string[]> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    const res = await fetch(url, { headers, signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return []
    const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
    return (data.data ?? [])
      .filter((m) => (filter ? filter(m) : true))
      .map((m) => (typeof m.id === "string" ? m.id : ""))
      .filter(Boolean)
  } catch {
    return []
  }
}

function dedupeSorted(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
  )
}

export function openAICompatibleAdapter(opts: OpenAICompatibleOptions): ChatProviderAdapter {
  return {
    provider: opts.provider,
    label: opts.label,
    isConfigured: () => !!opts.apiKey(),
    detail: () => (opts.apiKey() ? `${opts.label} API at ${opts.baseUrl()}` : "No API key configured"),
    configHint: () => (opts.apiKey() ? null : opts.setupHint),
    defaultModel: () => opts.defaultModel(),
    estimateCostUsd: opts.estimateCostUsd,
    listModels: async () => {
      const key = opts.apiKey()
      const live =
        opts.listRequiresKey && !key
          ? []
          : await fetchModelIds(
              `${opts.baseUrl().replace(/\/+$/, "")}/models`,
              key ? { Authorization: `Bearer ${key}` } : {},
              opts.modelFilter,
              5000,
            )
      return dedupeSorted([...live, ...opts.fallbackModels])
    },
    makeChatModel: ({ model, temperature, effort }: ChatModelOptions): ToolCallingChatModel => {
      const reasoningEffort = clampEffort(effort)
      return new ChatOpenAI({
        model: model || opts.defaultModel(),
        apiKey: opts.apiKey() ?? undefined,
        temperature: temperature ?? undefined,
        // Sent only when the user explicitly picked an effort — models without
        // reasoning support reject the parameter.
        ...(reasoningEffort ? { modelKwargs: { reasoning_effort: reasoningEffort } } : {}),
        configuration: {
          baseURL: opts.baseUrl(),
          ...(opts.defaultHeaders ? { defaultHeaders: opts.defaultHeaders } : {}),
        },
      })
    },
  }
}
