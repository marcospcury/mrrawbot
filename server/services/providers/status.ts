import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { ModelEntry, Provider, ProviderStatus } from "@shared/types.ts"
import { env } from "../../env.ts"
import { type CodexModelInfo, listCodexModels } from "./codex.ts"

const CLAUDE_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
  "opus",
  "sonnet",
  "haiku",
]
// Fallback only — the real list is queried live from the Codex app-server.
const CODEX_FALLBACK_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"]
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

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)))
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ])
}

function parseClaudeModels(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((m) => (typeof m === "string" ? m : (m as { id?: string; name?: string; model?: string })?.id ?? (m as { name?: string })?.name ?? (m as { model?: string })?.model ?? ""))
      .filter(Boolean)
  }
  if (raw && typeof raw === "object") {
    const data = raw as { models?: unknown; data?: unknown }
    return parseClaudeModels(data.models ?? data.data)
  }
  return []
}

let claudeModelsCache: string[] | null = null
async function fetchClaudeModels(available: boolean): Promise<string[]> {
  if (!available) return CLAUDE_MODELS
  if (claudeModelsCache) return claudeModelsCache
  try {
    const text = await withTimeout(
      new Promise<string>((resolve, reject) => {
        const child = spawn(env.claudeBinPath, ["models", "list", "--json"], { stdio: ["ignore", "pipe", "ignore"] })
        let out = ""
        child.stdout.on("data", (d) => (out += d.toString()))
        child.on("error", reject)
        child.on("close", (code) => {
          if (code === 0) resolve(out)
          else reject(new Error(`claude models list exited ${code}`))
        })
      }),
      4000,
    )
    claudeModelsCache = parseClaudeModels(JSON.parse(text))
    return claudeModelsCache.length ? claudeModelsCache : CLAUDE_MODELS
  } catch {
    claudeModelsCache = CLAUDE_MODELS
    return CLAUDE_MODELS
  }
}

/** Live Codex model catalog (slugs + hidden + Fast tier), with a static fallback. */
async function fetchCodexCatalog(available: boolean): Promise<CodexModelInfo[]> {
  if (!available) return CODEX_FALLBACK_MODELS.map((id) => ({ id, hidden: false, fastTier: null }))
  try {
    const models = await withTimeout(listCodexModels(), 6000)
    return models.length ? models : CODEX_FALLBACK_MODELS.map((id) => ({ id, hidden: false, fastTier: null }))
  } catch {
    return CODEX_FALLBACK_MODELS.map((id) => ({ id, hidden: false, fastTier: null }))
  }
}

async function fetchOllamaTags(baseUrl: string, headers: Record<string, string>, ms: number): Promise<string[]> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/tags`, { headers, signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return []
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> }
    return (data.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean)
  } catch {
    return []
  }
}

async function fetchOllamaModels(): Promise<string[]> {
  const cloudModels = env.ollamaApiKey
    ? await fetchOllamaTags(env.ollamaBaseUrl, { Authorization: `Bearer ${env.ollamaApiKey}` }, 5000)
    : []
  return dedupe([...cloudModels, ...OLLAMA_FALLBACK_MODELS]).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
  )
}

export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  const claudeAvailable = existsSync(env.claudeBinPath)
  const codexAuth = existsSync(path.join(env.codexHome ?? path.join(homedir(), ".codex"), "auth.json"))
  const codexAvailable = codexAuth || existsSync(env.codexBinPath) || env.codexBinPath === "codex"
  const [claudeModels, ollamaModels, codex] = await Promise.all([
    fetchClaudeModels(claudeAvailable),
    fetchOllamaModels(),
    fetchCodexCatalog(codexAvailable),
  ])
  const codexModels = dedupe([env.codexDefaultModel, ...codex.filter((m) => !m.hidden).map((m) => m.id), ...codex.filter((m) => m.hidden).map((m) => m.id)])

  const statuses: ProviderStatus[] = [
    {
      provider: "claude",
      label: "Claude Code",
      available: claudeAvailable,
      detail: claudeAvailable
        ? `Local CLI at ${env.claudeBinPath} (uses your Claude subscription login)`
        : "Claude Code CLI not found",
      models: dedupe([env.claudeDefaultModel, ...claudeModels, ...CLAUDE_MODELS]),
      fastModels: [],
      hiddenModels: [],
      configHint: claudeAvailable
        ? null
        : "Install Claude Code and run `claude login`, or set the CLI path in Settings.",
    },
    {
      provider: "codex",
      label: "Codex",
      available: codexAvailable,
      detail: codexAuth
        ? "Codex app-server (uses your existing Codex/ChatGPT login)"
        : "Codex CLI present — run `codex login` if calls fail",
      models: codexModels,
      fastModels: codex.filter((m) => m.fastTier).map((m) => m.id),
      hiddenModels: codex.filter((m) => m.hidden).map((m) => m.id),
      configHint: codexAuth ? null : "Run `codex login` (ChatGPT) or set OPENAI_API_KEY.",
    },
    {
      provider: "ollama",
      label: "Ollama Cloud",
      available: !!env.ollamaApiKey,
      detail: env.ollamaApiKey
        ? `Ollama Cloud at ${env.ollamaBaseUrl}`
        : "No API key configured",
      models: dedupe([env.ollamaDefaultModel, ...ollamaModels]).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
      ),
      fastModels: [],
      hiddenModels: [],
      configHint: env.ollamaApiKey
        ? null
        : "Add your Ollama Cloud API key in Settings (get one at ollama.com).",
    },
  ]

  return statuses
}

export async function getModelEntries(): Promise<ModelEntry[]> {
  const statuses = await getProviderStatuses()
  const seen = new Map<string, Provider[]>()
  const out = statuses.flatMap((status) => {
    const fast = new Set(status.fastModels)
    const hidden = new Set(status.hiddenModels)
    return status.models.map((id) => {
      seen.set(id, [...(seen.get(id) ?? []), status.provider])
      return {
        id,
        provider: status.provider,
        available: status.available,
        fast: fast.has(id),
        hidden: hidden.has(id),
        isDefault:
          id ===
          (status.provider === "claude"
            ? env.claudeDefaultModel
            : status.provider === "codex"
              ? env.codexDefaultModel
              : env.ollamaDefaultModel),
      } satisfies ModelEntry
    })
  })
  for (const [id, providers] of seen) {
    if (providers.length > 1) {
      console.warn(`[providers] model id "${id}" appears for ${providers.join(", ")}; keeping all provider entries`)
    }
  }
  return out
}

export function providerLabel(p: Provider): string {
  return p === "claude" ? "Claude Code" : p === "codex" ? "Codex" : "Ollama Cloud"
}
