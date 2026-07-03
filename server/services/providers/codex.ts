import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import readline from "node:readline"
import type { Effort, StepUsage } from "@shared/types.ts"
import { env } from "../../env.ts"
import { estimateCodexCostUsd } from "./pricing.ts"
import type { ProviderRunInput, ProviderRunOutput } from "./types.ts"

type Sandbox = "read-only" | "workspace-write" | "danger-full-access"
type CodexEffort = "low" | "medium" | "high" | "xhigh"

// Codex `model_reasoning_effort`: low | medium | high | xhigh (current GPT-5.x models).
// "max" is Claude-only; map it to Codex's top level, xhigh.
function codexEffort(effort: Effort | null): CodexEffort | undefined {
  if (!effort) return undefined
  if (effort === "max") return "xhigh"
  return effort
}
// Codex must run FRESH — carved from the ground up, carrying nothing from the
// user's real ~/.codex setup (config.toml, skills, notify hooks, MCP servers).
// Every spawn gets an app-managed CODEX_HOME containing only:
//   - a minimal config.toml that also disables AGENTS.md auto-injection
//     (the system prompt is fully owned by this harness), and
//   - auth.json copied from the user's real Codex home so login still works.
const ISOLATED_CONFIG = `# Managed by mrrawbot. Do not edit — rewritten on every run.
# Keeps Codex fresh: no user config, no skills, no AGENTS.md injection.
project_doc_max_bytes = 0
`

function isolatedCodexHome(): string {
  const home = join(dirname(env.dbPath), "codex-home")
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, "config.toml"), ISOLATED_CONFIG)
  const authSource = join(env.codexHome ?? join(homedir(), ".codex"), "auth.json")
  const authDest = join(home, "auth.json")
  if (existsSync(authSource)) {
    // Refresh only when the real auth is newer, so tokens Codex rotates inside
    // the isolated home are not clobbered with stale ones.
    const destMtime = existsSync(authDest) ? statSync(authDest).mtimeMs : -1
    if (statSync(authSource).mtimeMs > destMtime) copyFileSync(authSource, authDest)
  }
  return home
}

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void }
type NotifyHandler = (method: string, params: Record<string, unknown>) => void

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function compactUsage(usage: StepUsage): StepUsage | null {
  return Object.values(usage).some((v) => typeof v === "number" && Number.isFinite(v)) ? usage : null
}

function normalizeCodexUsage(raw: unknown): StepUsage | null {
  if (!raw || typeof raw !== "object") return null
  const u = raw as Record<string, unknown>
  const inputTokens = asNumber(u.inputTokens) ?? asNumber(u.input_tokens)
  const cachedInputTokens = asNumber(u.cachedInputTokens) ?? asNumber(u.cached_input_tokens)
  const outputTokens = asNumber(u.outputTokens) ?? asNumber(u.output_tokens)
  const reasoningOutputTokens = asNumber(u.reasoningOutputTokens) ?? asNumber(u.reasoning_output_tokens)
  const totalTokens =
    asNumber(u.totalTokens) ??
    asNumber(u.total_tokens) ??
    (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined)
  return compactUsage({ inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens })
}

function withCodexCost(model: string, usage: StepUsage | null, serviceTier?: string): StepUsage | null {
  if (!usage) return null
  return { ...usage, costUsd: usage.costUsd ?? estimateCodexCostUsd(model, usage, serviceTier) }
}

/**
 * Long-lived client for `codex app-server` (newline-delimited JSON-RPC, no jsonrpc field).
 * One instance is reused across tasks; each task starts a fresh thread + one turn.
 */
class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams
  private rl: readline.Interface
  private nextId = 1
  private pending = new Map<number, Pending>()
  private notifyHandlers = new Set<NotifyHandler>()
  private ready: Promise<void>
  private dead = false

  constructor() {
    const childEnv = { ...process.env, CODEX_HOME: isolatedCodexHome() }
    this.child = spawn(env.codexBinPath, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] , env: childEnv })
    this.child.on("exit", () => {
      this.dead = true
      for (const p of this.pending.values()) p.reject(new Error("codex app-server exited"))
      this.pending.clear()
    })
    this.child.stderr.on("data", (d) => {
      if (process.env.MRRAWBOT_DEBUG) process.stderr.write(`[codex] ${d}`)
    })
    this.rl = readline.createInterface({ input: this.child.stdout })
    this.rl.on("line", (line) => this.onLine(line))
    this.ready = this.handshake()
  }

  get isDead() {
    return this.dead
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n")
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  private notify(method: string, params?: unknown) {
    this.child.stdin.write(JSON.stringify({ method, params }) + "\n")
  }

  private respond(id: number | string, result: unknown) {
    this.child.stdin.write(JSON.stringify({ id, result }) + "\n")
  }

  private onLine(line: string) {
    if (!line.trim()) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    // Response to one of our requests.
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id as number)
      if (p) {
        this.pending.delete(msg.id as number)
        msg.error ? p.reject(msg.error) : p.resolve(msg.result)
      }
      return
    }
    // Server -> client request (e.g. approval). Auto-accept defensively so a stray
    // request never deadlocks a turn (we run with approvalPolicy 'never' anyway).
    if (msg.id !== undefined && msg.method) {
      const decision = /requestApproval/.test(msg.method as string) ? "accept" : "approved"
      this.respond(msg.id as number, { decision })
      return
    }
    // Server -> client notification.
    for (const h of this.notifyHandlers) h(msg.method as string, (msg.params ?? {}) as Record<string, unknown>)
  }

  private async handshake(): Promise<void> {
    await this.send("initialize", {
      clientInfo: { name: "mrrawbot", title: "mrrawbot", version: "0.1.0" },
      capabilities: { experimentalApi: false, requestAttestation: false },
    })
    this.notify("initialized")
  }

  async runTask(opts: {
    prompt: string
    baseInstructions?: string
    cwd: string
    model: string
    effort?: CodexEffort
    serviceTier?: string
    sandbox: Sandbox
    signal: AbortSignal
    onDelta?: (text: string) => void
    onLog?: (line: string) => void
    onTool?: ProviderRunInput["onTool"]
  }): Promise<ProviderRunOutput> {
    await this.ready
    const thread = (await this.send("thread/start", {
      cwd: opts.cwd,
      model: opts.model,
      sandbox: opts.sandbox,
      approvalPolicy: "never",
      ...(opts.baseInstructions ? { baseInstructions: opts.baseInstructions } : {}),
      ...(opts.effort ? { effort: opts.effort, modelReasoningEffort: opts.effort } : {}),
      ...(opts.serviceTier ? { serviceTier: opts.serviceTier } : {}),
    })) as { thread: { id: string } }
    const threadId = thread.thread.id

    let finalText = ""
    let usage: StepUsage | null = null
    const result = new Promise<ProviderRunOutput>((resolve, reject) => {
      const onAbort = () => {
        this.notifyHandlers.delete(handler)
        this.send("turn/interrupt", { threadId }).catch(() => {})
        reject(new Error("aborted"))
      }
      const handler: NotifyHandler = (method, params) => {
        if (params?.threadId && params.threadId !== threadId) return
        switch (method) {
          case "item/agentMessage/delta":
            opts.onDelta?.(String(params.delta ?? ""))
            break
          case "item/started": {
            const item = params.item as { type?: string } | undefined
            if (item?.type && item.type !== "agentMessage") opts.onLog?.(`→ ${item.type}`)
            if (item) opts.onTool?.({ id: String((item as { id?: unknown }).id ?? ""), name: `codex:${item.type ?? "item"}`, args: item })
            break
          }
          case "item/completed": {
            const item = params.item as { type?: string; text?: string } | undefined
            if (item?.type === "agentMessage" && typeof item.text === "string") finalText = item.text
            if (item) opts.onTool?.({ id: String((item as { id?: unknown }).id ?? ""), name: `codex:${item.type ?? "item"}`, args: item })
            break
          }
          case "thread/tokenUsage/updated": {
            const tokenUsage = params.tokenUsage as { total?: unknown; last?: unknown } | undefined
            usage = normalizeCodexUsage(tokenUsage?.last ?? tokenUsage?.total) ?? usage
            break
          }
          case "error":
            this.notifyHandlers.delete(handler)
            opts.signal.removeEventListener("abort", onAbort)
            reject(new Error(String((params.error as { message?: string })?.message ?? "codex turn error")))
            break
          case "turn/completed": {
            this.notifyHandlers.delete(handler)
            opts.signal.removeEventListener("abort", onAbort)
            usage = normalizeCodexUsage((params as { usage?: unknown }).usage) ?? usage
            const turn = params.turn as { status?: string; error?: { message?: string } } | undefined
            if (turn?.status === "failed") reject(new Error(turn.error?.message ?? "codex turn failed"))
            else resolve({ text: finalText, usage: withCodexCost(opts.model, usage, opts.serviceTier) })
            break
          }
        }
      }
      this.notifyHandlers.add(handler)
      opts.signal.addEventListener("abort", onAbort, { once: true })
    })

    await this.send("turn/start", {
      threadId,
      input: [{ type: "text", text: opts.prompt, text_elements: [] }],
      model: opts.model,
      ...(opts.effort ? { effort: opts.effort, modelReasoningEffort: opts.effort } : {}),
      ...(opts.serviceTier ? { serviceTier: opts.serviceTier } : {}),
    })
    return result
  }

  /** Query the live model catalog (slugs, default effort, Fast service tier). */
  async listModels(): Promise<CodexModelInfo[]> {
    await this.ready
    const res = (await this.send("model/list", {})) as { data?: RawCodexModel[] }
    return (res?.data ?? [])
      .map((m) => ({
        id: String(m.id ?? m.model ?? ""),
        hidden: !!m.hidden,
        fastTier: m.serviceTiers?.[0]?.id ?? null,
      }))
      .filter((m) => m.id)
  }

  close() {
    try {
      this.rl.close()
      this.child.stdin.end()
      this.child.kill()
    } catch {
      /* ignore */
    }
  }
}

interface RawCodexModel {
  id?: string
  model?: string
  hidden?: boolean
  serviceTiers?: Array<{ id?: string; name?: string }>
}

export interface CodexModelInfo {
  id: string
  hidden: boolean
  /** Service-tier id for "Fast" mode (e.g. "priority"), or null if unsupported. */
  fastTier: string | null
}

let client: CodexAppServerClient | null = null
function getClient(): CodexAppServerClient {
  if (!client || client.isDead) client = new CodexAppServerClient()
  return client
}

process.once("exit", () => client?.close())

// The model catalog is stable per CLI version; cache it after the first query.
let modelsCache: CodexModelInfo[] | null = null
export async function listCodexModels(): Promise<CodexModelInfo[]> {
  if (modelsCache) return modelsCache
  modelsCache = await getClient().listModels()
  return modelsCache
}

/** Resolve the "Fast" service-tier id for a model, or null if it has none. */
async function fastTierFor(model: string): Promise<string | null> {
  try {
    return (await listCodexModels()).find((m) => m.id === model)?.fastTier ?? null
  } catch {
    return null
  }
}

/** Fallback: one-shot `codex exec --json` capturing the final agent message. */
async function runCodexExec(input: ProviderRunInput, sandbox: Sandbox, serviceTier?: string): Promise<ProviderRunOutput> {
  const dir = await mkdtemp(join(tmpdir(), "mrrawbot-codex-"))
  const lastFile = join(dir, "last.txt")
  const effort = codexEffort(input.effort)
  const args = ["exec", "--json", "-o", lastFile, "-m", input.model, "-s", sandbox, "-C", input.cwd, "--skip-git-repo-check"]
  const system = input.system.trim()
  if (system) {
    // Replace (not append to) Codex's built-in system prompt.
    const instructionsFile = join(dir, "instructions.md")
    await writeFile(instructionsFile, system, "utf8")
    args.push("-c", `model_instructions_file=${JSON.stringify(instructionsFile)}`)
  }
  if (effort) args.push("-c", `model_reasoning_effort=${effort}`)
  if (serviceTier) args.push("-c", `service_tier=${serviceTier}`)
  args.push("-")
  const childEnv = { ...process.env, CODEX_HOME: isolatedCodexHome() }

  const child = spawn(env.codexBinPath, args, { stdio: ["pipe", "pipe", "pipe"], env: childEnv })
  input.signal.addEventListener("abort", () => child.kill(), { once: true })
  child.stdin.write(input.prompt)
  child.stdin.end()

  let fallbackText = ""
  let usage: StepUsage | null = null
  let buf = ""
  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString()
    let nl: number
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      try {
        const evt = JSON.parse(line)
        if (evt.type === "item.completed" && evt.item?.type === "agent_message") {
          fallbackText = evt.item.text
          input.onToken?.(evt.item.text)
        }
        if (evt.type === "turn.completed") usage = normalizeCodexUsage(evt.usage) ?? usage
        if (evt.item && (evt.type === "item.started" || evt.type === "item.completed")) {
          input.onTool?.({
            id: String(evt.item.id ?? ""),
            name: `codex:${String(evt.item.type ?? "item")}`,
            args: evt.item,
          })
        }
      } catch {
        /* ignore */
      }
    }
  })
  let stderr = ""
  child.stderr.on("data", (d) => (stderr += d.toString()))

  const code: number = await new Promise((res) => child.on("close", res))
  if (code !== 0 && !input.signal.aborted) throw new Error(`codex exec exited ${code}: ${stderr.slice(0, 500)}`)
  try {
    return { text: (await readFile(lastFile, "utf8")).trim() || fallbackText, usage: withCodexCost(input.model, usage, serviceTier) }
  } catch {
    return { text: fallbackText, usage: withCodexCost(input.model, usage, serviceTier) }
  }
}

export async function runCodex(input: ProviderRunInput): Promise<ProviderRunOutput> {
  // No permission gating: the agent has full access to the workspace and beyond.
  const sandbox: Sandbox = "danger-full-access"
  const model = input.model || env.codexDefaultModel
  // The system prompt REPLACES Codex's built-in instructions (baseInstructions
  // on thread/start), mirroring how Claude and Ollama override their defaults.
  const system = input.system.trim()
  // "Fast mode" is a service tier, not a reasoning effort. Only apply it when
  // the selected model actually advertises a Fast tier.
  const serviceTier = input.fast ? (await fastTierFor(model)) ?? undefined : undefined
  try {
    return await getClient().runTask({
      prompt: input.prompt,
      baseInstructions: system || undefined,
      cwd: input.cwd,
      model,
      effort: codexEffort(input.effort),
      serviceTier,
      sandbox,
      signal: input.signal,
      onDelta: input.onToken,
      onLog: input.onLog,
      onTool: input.onTool,
    })
  } catch (err) {
    if (input.signal.aborted) throw err
    // app-server unavailable / errored — fall back to one-shot exec.
    input.onLog?.(`app-server failed (${(err as Error).message}); falling back to codex exec`)
    return await runCodexExec({ ...input, model }, sandbox, serviceTier)
  }
}
