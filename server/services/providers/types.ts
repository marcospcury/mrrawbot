import type { Effort, StepUsage } from "@shared/types.ts"

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
