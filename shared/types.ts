// Shared contracts between the Express backend and the React frontend.
// Keep this framework-free so both sides can import it.

export type Provider = "ollama" | "codex" | "claude"

export const PROVIDERS: Provider[] = ["claude", "codex", "ollama"]

export interface ModelEntry {
  id: string
  provider: Provider
  available: boolean
  fast: boolean
  hidden: boolean
  isDefault: boolean
}

/**
 * Reasoning effort, mapped to each provider's real `reasoning effort` options:
 * - Claude: Agent SDK `effort` — low | medium | high | xhigh | max
 * - Codex:  `model_reasoning_effort` — low | medium | high | xhigh (current GPT-5.x models)
 * - Ollama: `think` on/off (low = off, anything higher = on)
 *
 * NOTE: Codex "Fast mode" is a separate service tier (`service_tier = "fast"`),
 * NOT a reasoning-effort level — it is intentionally not modeled here.
 */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max"

export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"]

/** Effort levels worth offering per provider (others are mapped to the nearest supported level). */
export function effortsFor(provider: Provider): Effort[] {
  switch (provider) {
    case "claude":
      return ["low", "medium", "high", "xhigh", "max"]
    case "codex":
      return ["low", "medium", "high", "xhigh"]
    case "ollama":
      return ["low", "high"] // low = no thinking, high = thinking
  }
}

/** Human label for an effort level on a given provider. */
export function effortLabel(provider: Provider, effort: Effort): string {
  if (provider === "ollama") return effort === "low" ? "no thinking" : "thinking"
  return effort
}

/**
 * A task-specific "role" an agent takes on. Each role maps to a full,
 * provider-adapted system prompt (resolved server-side from the prompt pack:
 * Claude/Codex variants verbatim, an adapted variant for Ollama). The same role
 * works on any provider, so a flow can mix providers freely while keeping the
 * role's behavior consistent.
 *
 * This file intentionally carries only role *metadata* (id, name, description)
 * so it stays light for the browser bundle; the heavy prompt bodies live on the
 * server in `server/services/roles`.
 */
export interface RoleInfo {
  id: string
  name: string
  description: string
}

export const ROLES: RoleInfo[] = [
  { id: "coder", name: "Coder", description: "Implements, fixes, refactors, and tests code." },
  { id: "planner", name: "Planner", description: "Explores the code and produces a concrete implementation plan." },
  {
    id: "heavy-planner",
    name: "Heavy Planner",
    description: "Exhaustive planning: architecture fit, blast radius, edge cases, and guarded steps a smaller model can execute.",
  },
  { id: "reviewer", name: "Reviewer", description: "Reviews changes for correctness, security, and risk." },
  {
    id: "product-specialist",
    name: "Product Specialist",
    description: "Turns goals into specs, user stories, and acceptance criteria.",
  },
  {
    id: "distributed-systems-architect",
    name: "Distributed Systems Architect",
    description: "Designs scalable, reliable, distributed architectures.",
  },
]

export const ROLE_IDS: string[] = ROLES.map((r) => r.id)

/** The role a single agent / new step takes on by default. */
export const DEFAULT_ROLE_ID = "coder"

export function roleInfo(id: string): RoleInfo | undefined {
  return ROLES.find((r) => r.id === id)
}

/** Friendly display name for a role id, falling back to the raw id. */
export function roleName(id: string): string {
  return roleInfo(id)?.name ?? id
}

export interface GitRepo {
  path: string
  name: string
  remoteUrl: string | null
  isGitHub: boolean
  githubOwner: string | null
  githubRepo: string | null
  branch: string | null
  dirty: boolean
  lastCommitAt: string | null
}

export interface ProjectGitRemote {
  name: string
  url: string | null
  host: string | null
  owner: string | null
  repo: string | null
  isGitHub: boolean
}

export interface PullRequestSummary {
  number: number
  title: string
  url: string
  state: string
  draft: boolean
  merged: boolean
  mergedAt: string | null
  headRefName: string
  baseRefName: string
  headSha: string
  author: string | null
}

export interface ProjectGitStatus {
  path: string
  isGit: boolean
  branch: string | null
  defaultBranch: string | null
  headSha: string | null
  remoteHeadSha: string | null
  dirty: boolean
  ahead: number
  behind: number
  upstream: string | null
  hasUpstream: boolean
  published: boolean
  canPush: boolean
  canPull: boolean
  refreshedAt: string
  remoteFetchedAt: string | null
  remoteFetchError: string | null
  remote: ProjectGitRemote | null
  pullRequest: PullRequestSummary | null
  github: {
    authenticated: boolean
    error: string | null
  } | null
}

export type GitHubMergeMethod = "merge" | "squash" | "rebase"

export interface GitHubStatusRow {
  id: string
  type: "check" | "status"
  name: string
  status: string
  conclusion: string | null
  details: string | null
  url: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface GitHubReviewSummary {
  id: number
  author: string | null
  state: string
  submittedAt: string | null
  body: string | null
  url: string | null
}

export interface GitHubCommentSummary {
  id: number
  type: "issue" | "review"
  author: string | null
  body: string
  url: string | null
  createdAt: string
  path: string | null
  line: number | null
}

export interface GitHubMergeAvailability {
  canMerge: boolean
  mergeable: boolean | null
  state: string | null
  blockedReason: string | null
  allowedMethods: GitHubMergeMethod[]
  defaultMethod: GitHubMergeMethod | null
  expectedHeadSha: string | null
}

export interface ProjectPullRequestDetails {
  status: ProjectGitStatus
  pullRequest: PullRequestSummary | null
  checks: GitHubStatusRow[]
  reviews: GitHubReviewSummary[]
  comments: GitHubCommentSummary[]
  merge: GitHubMergeAvailability | null
}

export interface PullRequestMergeResult {
  merged: boolean
  message: string
  sha: string | null
}

/**
 * A reusable agent template. Templates are starting points you can insert into a
 * flow; once in a flow, each step carries its own copy of this config (fully editable).
 */
export interface AgentConfig {
  id: string
  name: string
  provider: Provider
  model: string
  effort: Effort | null
  role: string
  systemPrompt: string
  /** Loop budget: max turns (claude), ReAct iterations (ollama). */
  maxIterations: number
  temperature: number | null
  isBuiltin: boolean
  createdAt: string
  updatedAt: string
}

export type NewAgentConfig = Pick<
  AgentConfig,
  | "name"
  | "provider"
  | "model"
  | "effort"
  | "role"
  | "systemPrompt"
  | "maxIterations"
  | "temperature"
>

export interface FlowStepLoop {
  /** Step id to route back to when not approved. */
  to: string
  /** Case-insensitive substring in the reviewer output that means "approved". */
  approveWhen: string
  maxLoops: number
}

/**
 * A fully self-contained step in a flow. Every step independently chooses its
 * provider, model, reasoning effort, instructions, and capabilities — mix and
 * match freely (e.g. an Ollama planner + a Claude reviewer).
 */
export interface FlowStep {
  /** Stable id used as the graph node id and as a loop target. */
  id: string
  name: string
  provider: Provider
  model: string
  effort: Effort | null
  /** Codex only: run on the "Fast" service tier (≈1.5× speed, more credits). */
  fast: boolean
  /**
   * Task-specific role id (see `ROLES`). When set, the role supplies the step's
   * provider-adapted system prompt and `systemPrompt` becomes optional extra
   * instructions layered on top. Empty string means "custom" — `systemPrompt`
   * is then the entire prompt (legacy behavior).
   */
  role: string
  systemPrompt: string
  maxIterations: number
  temperature: number | null
  /**
   * "single": one provider invocation.
   * "plan-executor": execute the previous step's structured plan step-by-step
   * with fresh provider invocations, then run completion checks.
   */
  mode: "single" | "plan-executor"
  /** Safety ceiling for plan-executor completion-check passes. */
  maxCompletionPasses: number
  loop: FlowStepLoop | null
}

export interface FlowConfig {
  id: string
  name: string
  description: string
  steps: FlowStep[]
  isBuiltin: boolean
  createdAt: string
  updatedAt: string
}

export type NewFlowConfig = Pick<FlowConfig, "name" | "description" | "steps">

export interface Project {
  id: string
  name: string
  repoPath: string
  repoName: string
  defaultFlowId: string | null
  createdAt: string
  updatedAt: string
}

export interface FileTreeEntry {
  name: string
  path: string
  type: "file" | "dir"
}

export interface FileContent {
  path: string
  content: string
  truncated: boolean
  binary: boolean
  size: number
}

export type ThreadChangeStatus = "added" | "modified" | "deleted"

export interface ThreadChange {
  id: string
  threadId: string
  runId: string | null
  filePath: string
  changeStatus: ThreadChangeStatus
  beforeContent: string | null
  afterContent: string | null
  beforeMissing: boolean
  truncated: boolean
  binary: boolean
  createdAt: string
}

/**
 * A single-agent "quick run" config. When a thread has no flow selected
 * (`flowId === null`) it runs as one agent driven entirely by this config —
 * pick a provider/model/effort and go, no flow required. Agents always have
 * full access to the repository; there is no permission gating anywhere.
 */
export interface SessionConfig {
  provider: Provider
  /** Empty string means "use the provider's default model". */
  model: string
  effort: Effort | null
  /** Codex only: run on the "Fast" service tier (≈1.5× speed, more credits). */
  fast: boolean
  /** Task-specific role the single agent takes on (see `ROLES`). */
  role: string
}

export function defaultSession(provider: Provider = "claude"): SessionConfig {
  return { provider, model: "", effort: null, fast: false, role: DEFAULT_ROLE_ID }
}

export interface Thread {
  id: string
  projectId: string
  title: string
  archived: boolean
  /** When set, run this flow. When null, run a single agent from `session`. */
  flowId: string | null
  /** Single-agent config used when `flowId` is null (quick-run mode). */
  session: SessionConfig | null
  /** Timestamp when a title was first auto-generated. Presence means auto-naming is locked. */
  autoTitleGeneratedAt: string | null
  /** Whether the user has explicitly edited the title at least once. */
  titleManuallyEdited: boolean
  createdAt: string
  updatedAt: string
}

/** A thread runs either as a single ad-hoc agent or as a saved flow. */
export type ThreadMode = "single" | "flow"

export function threadMode(thread: Pick<Thread, "flowId">): ThreadMode {
  return thread.flowId ? "flow" : "single"
}

export type MessageRole = "user" | "assistant" | "system"

export interface ChatMessage {
  id: string
  threadId: string
  role: MessageRole
  content: string
  runId: string | null
  createdAt: string
}

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped"
export type RunStatus = "running" | "done" | "error" | "cancelled"

export interface StepUsage {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
  totalTokens?: number
  costUsd?: number
}

export interface RunStep {
  id: string
  agentName: string
  provider: Provider
  model: string
  effort: Effort | null
  title: string
  status: StepStatus
  output: string
  logs: string[]
  iteration: number
  isFinal: boolean
  error: string | null
  usage: StepUsage | null
  startedAt: number | null
  endedAt: number | null
}

/** Streamed to the chat UI as CoAgent shared state (STATE_SNAPSHOT). */
export interface AgentRunState {
  runId: string
  threadId: string
  flowId: string | null
  flowName: string
  status: RunStatus
  steps: RunStep[]
  activeStepId: string | null
  startedAt: number
  endedAt: number | null
  error: string | null
}

export interface AgentRunRecord {
  id: string
  threadId: string
  messageId: string | null
  flowId: string | null
  status: RunStatus
  state: AgentRunState
  createdAt: string
}

export interface ProviderStatus {
  provider: Provider
  label: string
  available: boolean
  detail: string
  models: string[]
  /** Subset of `models` that support the Codex "Fast" service tier. */
  fastModels: string[]
  /** Subset of `models` that the upstream provider marks hidden. */
  hiddenModels: string[]
  configHint: string | null
}

export interface ProviderConfig {
  claudeBinPath: string
  codexBinPath: string
  /** True when the effective value comes from the app database (vs env/auto-detection). */
  claudeBinPathStored: boolean
  codexBinPathStored: boolean
  ollamaApiKeySet: boolean
  ollamaApiKeyStored: boolean
}

export interface ProviderConfigPatch {
  claudeBinPath?: string | null
  codexBinPath?: string | null
  ollamaApiKey?: string | null
}

export interface AppInfo {
  name: string
  version: string
  repoRoots: string[]
  dbPath: string
  copilotRuntimeUrl: string
}
