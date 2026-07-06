import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import type { Effort, Provider, StepUsage } from "@shared/types.ts"

export interface ProviderRunInput {
  /** Full prompt for the agent (system + role + task + accumulated context). */
  prompt: string
  /** System prompt (role definition) — used by providers that separate it. */
  system: string
  model: string
  effort: Effort | null
  /** Codex only: run on the "Fast" service tier. Other providers ignore it. */
  fast: boolean
  cwd: string
  /** Absolute thread upload directory for file attachment path injection. */
  uploadsDir?: string
  /**
   * Extra writable root for roles whose deliverable lives outside the repo
   * (the UI designer's app-internal design workspace). Claude and Codex reach
   * it via the absolute path in the prompt; Ollama's path-scoped file tools
   * accept it as a second allowed root.
   */
  workspaceDir?: string
  /**
   * Absolute paths of the role's bundled skill folders (each holds a SKILL.md).
   * Ollama serves them through its list_skills/read_skill tools; Claude and
   * Codex read them by path (the system prompt lists them), so they ignore this.
   */
  skillDirs?: string[]
  maxIterations: number
  temperature: number | null
  signal: AbortSignal
  /** Stream assistant text deltas (for live UI). */
  onToken?: (text: string) => void
  /** Emit a non-assistant log line (tool/command activity). */
  onLog?: (line: string) => void
  /** Emit a structured tool call/result for rendering. */
  onTool?: (tool: { id: string; name: string; args?: unknown; result?: string }) => void
}

export interface ProviderRunOutput {
  text: string
  usage: StepUsage | null
}

export type ProviderRunner = (input: ProviderRunInput) => Promise<ProviderRunOutput>

/** A chat model that can bind tools (every model we run agents on must). */
export type ToolCallingChatModel = BaseChatModel & { bindTools: NonNullable<BaseChatModel["bindTools"]> }

export interface ChatModelOptions {
  model: string
  temperature: number | null
  effort: Effort | null
}

/**
 * Adapter for a provider that runs through the shared LangChain agent loop
 * (`runChatAgent`). Claude and Codex have their own native harnesses and don't
 * use this; every API-based provider (Ollama Cloud, OpenRouter, Hugging Face,
 * Cerebras, ...) is just one of these — adding a provider means writing an
 * adapter, registering it, and adding it to the shared `Provider` union.
 */
export interface ChatProviderAdapter {
  provider: Provider
  label: string
  /** True when the provider has what it needs to run (API key, etc.). */
  isConfigured(): boolean
  /** One-line status shown in Settings → Providers. */
  detail(): string
  /** Setup instruction shown when unconfigured (null when ready). */
  configHint(): string | null
  defaultModel(): string
  /** Model catalog: live listing when reachable, merged with a static fallback. */
  listModels(): Promise<string[]>
  makeChatModel(opts: ChatModelOptions): ToolCallingChatModel
  /** Optional cost estimation attached to normalized usage. May consult a cached live catalog. */
  estimateCostUsd?(model: string, usage: StepUsage): number | undefined | Promise<number | undefined>
}
