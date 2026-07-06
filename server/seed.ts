import { createHash } from "node:crypto"
import type { Effort, FlowStep, NewAgentConfig, NewFlowConfig, Provider } from "@shared/types.ts"
import { BUILD_ROLES } from "@shared/types.ts"
import { countAgents, createAgent, listAgents, removeBuiltinAgent } from "./db/repos/agents.ts"
import { createFlow, listDeletedBuiltinFlowIds, listFlows, removeBuiltinFlow } from "./db/repos/flows.ts"
import { getSetting, setSetting } from "./db/repos/settings.ts"
import { env } from "./env.ts"

/**
 * Builtin agents and flows, refreshed on boot whenever their definitions
 * change (content-hashed — no version constant to bump):
 *
 * - Agents are DERIVED from `BUILD_ROLES`: every build-surface role ships one
 *   starter agent, so a newly added role appears for both fresh installs and
 *   upgrades without touching this file. `AGENT_TUNING` only adjusts per-role
 *   defaults. Product Design roles (product-specialist, ui-designer) live in
 *   Product Design sessions, not in flows or agent templates.
 * - Flows stay hand-curated (they are compositions, not derivable), but any
 *   edit here reaches existing installs on their next boot.
 * - A refresh never destroys user intent: custom agents/flows are untouched,
 *   builtins the user edited are kept as-is, and builtin flows the user
 *   deleted stay deleted (tombstoned by `deleteFlow`).
 */

const M: Record<Provider, string> = {
  claude: env.claudeDefaultModel,
  codex: env.codexDefaultModel,
  ollama: env.ollamaDefaultModel,
  openrouter: env.openrouterDefaultModel,
  huggingface: env.huggingfaceDefaultModel,
  cerebras: env.cerebrasDefaultModel,
}

// Flow-specific nudge for a Reviewer step that gates a review loop: the role's
// own output is a findings report, so we ask it to end with the APPROVE/REVISE
// token the loop matches on.
const REVIEW_LOOP_INSTRUCTION =
  "This step gates a review loop. After your review, finish with a single standalone final line: " +
  "write exactly `APPROVE` when the change is correct, complete, and safe to keep as-is, or `REVISE` " +
  "followed by a numbered list of the specific fixes the implementer must make. The flow loops back to " +
  "the implementer until you APPROVE."

/** Per-role deviations from the generic starter-agent template (Claude, high effort). */
interface AgentTuning {
  provider?: Provider
  effort?: Effort
  maxIterations?: number
  temperature?: number | null
  /** Extra instructions layered on top of the role prompt. */
  instructions?: string
}

const AGENT_TUNING: Partial<Record<string, AgentTuning>> = {
  planner: { maxIterations: 18 },
  "heavy-planner": { maxIterations: 24 },
  coder: { provider: "ollama", maxIterations: 14, temperature: 0.1 },
  reviewer: { provider: "codex", maxIterations: 10, instructions: REVIEW_LOOP_INSTRUCTION },
}

/** One reusable starter agent per build role (insert into flows as starting points). */
function builtinAgents(): Array<NewAgentConfig & { id: string }> {
  return BUILD_ROLES.map((role) => {
    const tuning = AGENT_TUNING[role.id] ?? {}
    const provider = tuning.provider ?? "claude"
    return {
      id: `agent_${role.id}`,
      name: role.name,
      provider,
      model: M[provider],
      effort: tuning.effort ?? "high",
      role: role.id,
      systemPrompt: tuning.instructions ?? "",
      maxIterations: tuning.maxIterations ?? 16,
      temperature: tuning.temperature ?? null,
    }
  })
}

function step(s: {
  id: string
  name: string
  provider: Provider
  model: string
  role: string
  effort?: Effort | null
  maxIterations?: number
  mode?: FlowStep["mode"]
  maxCompletionPasses?: number
  /** Extra, flow-specific instructions layered on top of the role prompt. */
  instructions?: string
  loop?: FlowStep["loop"]
}): FlowStep {
  return {
    id: s.id,
    name: s.name,
    provider: s.provider,
    model: s.model,
    effort: s.effort ?? null,
    fast: false,
    role: s.role,
    systemPrompt: s.instructions ?? "",
    maxIterations: s.maxIterations ?? 14,
    temperature: null,
    mode: s.mode ?? "single",
    maxCompletionPasses: s.maxCompletionPasses ?? 10,
    loop: s.loop ?? null,
  }
}

// Flow step roles must match `ROLES` in shared/types.ts; the seed test
// cross-checks every step against ROLE_IDS.
function builtinFlows(): Array<NewFlowConfig & { id: string }> {
  return [
    {
      id: "flow_claude",
      name: "Claude Code",
      description: "A single Claude Code agent (Coder), end to end.",
      steps: [step({ id: "s_claude", name: "Claude Code", provider: "claude", model: M.claude, role: "coder" })],
    },
    {
      id: "flow_codex",
      name: "Codex",
      description: "A single Codex agent (Coder, medium effort).",
      steps: [step({ id: "s_codex", name: "Codex", provider: "codex", model: M.codex, role: "coder", effort: "medium" })],
    },
    {
      id: "flow_ollama",
      name: "Ollama Cloud",
      description: "A single Ollama Cloud agent (Coder) with repo tools.",
      steps: [step({ id: "s_ollama", name: "Ollama", provider: "ollama", model: M.ollama, role: "coder" })],
    },
    {
      id: "flow_plan_build",
      name: "Plan → Build",
      description: "Claude plans, then Ollama implements each plan step with fresh context and completion checks.",
      steps: [
        step({ id: "s_plan", name: "Planner", provider: "claude", model: M.claude, role: "planner", effort: "high", maxIterations: 18 }),
        step({
          id: "s_build",
          name: "Coder",
          provider: "ollama",
          model: M.ollama,
          role: "coder",
          effort: "high",
          mode: "plan-executor",
          maxCompletionPasses: 10,
        }),
      ],
    },
    {
      id: "flow_heavy_plan_build",
      name: "Heavy Plan → Build",
      description:
        "Claude writes an exhaustive, guarded plan (architecture fit, blast radius, edge cases), then Ollama executes it step by step — the plan is written so a smaller model can follow it safely.",
      steps: [
        step({ id: "s_hplan", name: "Heavy Planner", provider: "claude", model: M.claude, role: "heavy-planner", effort: "high", maxIterations: 24 }),
        step({
          id: "s_hbuild",
          name: "Coder",
          provider: "ollama",
          model: M.ollama,
          role: "coder",
          effort: "high",
          mode: "plan-executor",
          maxCompletionPasses: 10,
        }),
      ],
    },
    {
      id: "flow_plan_execute_review",
      name: "Plan → Execute → Review",
      description: "Claude plans, Ollama implements, Codex reviews — looping back to the coder until approved.",
      steps: [
        step({ id: "s_plan", name: "Planner", provider: "claude", model: M.claude, role: "planner", effort: "high", maxIterations: 18 }),
        step({ id: "s_exec", name: "Coder", provider: "ollama", model: M.ollama, role: "coder", effort: "high" }),
        step({
          id: "s_review",
          name: "Reviewer",
          provider: "codex",
          model: M.codex,
          role: "reviewer",
          effort: "high",
          maxIterations: 10,
          instructions: REVIEW_LOOP_INSTRUCTION,
          loop: { to: "s_exec", approveWhen: "APPROVE", maxLoops: 2 },
        }),
      ],
    },
    {
      id: "flow_ollama_plan",
      name: "Ollama Plan → Codex Build",
      description: "An example with the providers flipped: Ollama plans (fast), Codex implements.",
      steps: [
        step({ id: "s_oplan", name: "Planner", provider: "ollama", model: M.ollama, role: "planner", effort: "high" }),
        step({ id: "s_cbuild", name: "Coder", provider: "codex", model: M.codex, role: "coder", effort: "medium" }),
      ],
    },
  ]
}

function wasEdited(row: { createdAt: string; updatedAt: string }): boolean {
  return row.updatedAt !== row.createdAt
}

export function seedDefaults(): void {
  const agents = builtinAgents()
  const flows = builtinFlows()
  // Content-addressed seeding: any change to the definitions above (a new
  // role, a tweaked flow, a different default model) changes the hash and
  // refreshes the builtins on the next boot.
  const hash = createHash("sha256").update(JSON.stringify({ agents, flows })).digest("hex")
  if (getSetting<string>("seedHash") === hash && countAgents() > 0) return

  // Drop unedited builtins, then (re)create every definition that isn't
  // already covered by an edited row the user owns.
  for (const existing of listAgents()) {
    if (existing.isBuiltin && !wasEdited(existing)) removeBuiltinAgent(existing.id)
  }
  const keptAgents = new Set(listAgents().map((a) => a.id))
  for (const { id, ...rest } of agents) {
    if (!keptAgents.has(id)) createAgent(rest, { id, isBuiltin: true })
  }

  for (const existing of listFlows()) {
    if (existing.isBuiltin && !wasEdited(existing)) removeBuiltinFlow(existing.id)
  }
  const deletedFlowIds = new Set(listDeletedBuiltinFlowIds())
  const keptFlows = new Set(listFlows().map((f) => f.id))
  for (const { id, ...rest } of flows) {
    if (!deletedFlowIds.has(id) && !keptFlows.has(id)) createFlow(rest, { id, isBuiltin: true })
  }

  setSetting("seedHash", hash)
}
