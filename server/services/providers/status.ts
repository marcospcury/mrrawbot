import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { ModelEntry, Provider, ProviderStatus } from "@shared/types.ts"
import { env } from "../../env.ts"
import { type CodexModelInfo, listCodexModels } from "./codex.ts"
import { CHAT_ADAPTERS } from "./registry.ts"

const CLAUDE_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
]

// Bare family aliases ("opus") are interchangeable with their versioned id and
// only clutter the picker; keep them just when no versioned id covers them.
const CLAUDE_ALIAS = /^(opus|sonnet|haiku|fable)$/
function dedupeClaudeAliases(models: string[]): string[] {
  return models.filter(
    (m) => !CLAUDE_ALIAS.test(m) || !models.some((other) => other.startsWith(`claude-${m}`)),
  )
}
// Fallback only — the real list is queried live from the Codex app-server.
const CODEX_FALLBACK_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"]

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

function claudeConfigured(): boolean {
  return existsSync(env.claudeBinPath)
}

function codexConfigured(): boolean {
  const codexAuth = existsSync(path.join(env.codexHome ?? path.join(homedir(), ".codex"), "auth.json"))
  return codexAuth || existsSync(env.codexBinPath) || env.codexBinPath === "codex"
}

/**
 * Cheap synchronous availability check — used to gate a run before it starts
 * (a flow step or quick-run session on an unconfigured provider must not run).
 */
export function isProviderConfigured(provider: Provider): boolean {
  if (provider === "claude") return claudeConfigured()
  if (provider === "codex") return codexConfigured()
  return CHAT_ADAPTERS[provider]?.isConfigured() ?? false
}

/** The subset of `providers` that isn't set up yet, in input order. */
export function unconfiguredProviders(providers: Provider[]): Provider[] {
  return [...new Set(providers)].filter((p) => !isProviderConfigured(p))
}

function adapterStatus(provider: Provider, defaultModel: string, models: string[]): ProviderStatus {
  const adapter = CHAT_ADAPTERS[provider]!
  return {
    provider,
    label: adapter.label,
    available: adapter.isConfigured(),
    detail: adapter.detail(),
    models: dedupe([defaultModel, ...models]).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
    ),
    fastModels: [],
    hiddenModels: [],
    configHint: adapter.configHint(),
  }
}

export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  const claudeAvailable = claudeConfigured()
  const codexAuth = existsSync(path.join(env.codexHome ?? path.join(homedir(), ".codex"), "auth.json"))
  const codexAvailable = codexConfigured()
  const [claudeModels, codex, ollamaModels, openrouterModels, huggingfaceModels, cerebrasModels] =
    await Promise.all([
      fetchClaudeModels(claudeAvailable),
      fetchCodexCatalog(codexAvailable),
      CHAT_ADAPTERS.ollama!.listModels(),
      CHAT_ADAPTERS.openrouter!.listModels(),
      CHAT_ADAPTERS.huggingface!.listModels(),
      CHAT_ADAPTERS.cerebras!.listModels(),
    ])
  const codexModels = dedupe([env.codexDefaultModel, ...codex.filter((m) => !m.hidden).map((m) => m.id), ...codex.filter((m) => m.hidden).map((m) => m.id)])

  return [
    {
      provider: "claude",
      label: "Claude Code",
      available: claudeAvailable,
      detail: claudeAvailable
        ? `Local CLI at ${env.claudeBinPath} (uses your Claude subscription login)`
        : "Claude Code CLI not found",
      models: dedupeClaudeAliases(dedupe([env.claudeDefaultModel, ...claudeModels, ...CLAUDE_MODELS])),
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
    adapterStatus("ollama", env.ollamaDefaultModel, ollamaModels),
    adapterStatus("openrouter", env.openrouterDefaultModel, openrouterModels),
    adapterStatus("huggingface", env.huggingfaceDefaultModel, huggingfaceModels),
    adapterStatus("cerebras", env.cerebrasDefaultModel, cerebrasModels),
  ]
}

function defaultModelFor(provider: Provider): string {
  switch (provider) {
    case "claude":
      return env.claudeDefaultModel
    case "codex":
      return env.codexDefaultModel
    case "ollama":
      return env.ollamaDefaultModel
    case "openrouter":
      return env.openrouterDefaultModel
    case "huggingface":
      return env.huggingfaceDefaultModel
    case "cerebras":
      return env.cerebrasDefaultModel
  }
}

export async function getModelEntries(): Promise<ModelEntry[]> {
  const statuses = await getProviderStatuses()
  // The same model id can legitimately appear on several providers (e.g.
  // gpt-oss-120b on OpenRouter and Cerebras); entries are keyed by
  // provider + id everywhere, so duplicates across providers are fine.
  return statuses.flatMap((status) => {
    const fast = new Set(status.fastModels)
    const hidden = new Set(status.hiddenModels)
    return status.models.map((id) => {
      return {
        id,
        provider: status.provider,
        available: status.available,
        fast: fast.has(id),
        hidden: hidden.has(id),
        isDefault: id === defaultModelFor(status.provider),
      } satisfies ModelEntry
    })
  })
}

export function providerLabel(p: Provider): string {
  switch (p) {
    case "claude":
      return "Claude Code"
    case "codex":
      return "Codex"
    case "ollama":
      return "Ollama Cloud"
    case "openrouter":
      return "OpenRouter"
    case "huggingface":
      return "Hugging Face"
    case "cerebras":
      return "Cerebras"
  }
}
