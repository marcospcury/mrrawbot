import type { Effort, FlowStep, NewAgentConfig, NewFlowConfig, Provider } from "@shared/types.ts"
import { countAgents, createAgent, deleteBuiltinAgents } from "./db/repos/agents.ts"
import { createFlow, deleteBuiltinFlows, listDeletedBuiltinFlowIds } from "./db/repos/flows.ts"
import { getSetting, setSetting } from "./db/repos/settings.ts"
import { env } from "./env.ts"

const SEED_VERSION = 5

const M = {
  claude: env.claudeDefaultModel,
  codex: env.codexDefaultModel,
  ollama: env.ollamaDefaultModel,
}

// Role ids — must match `ROLES` in shared/types.ts. The role supplies each
// agent's provider-adapted system prompt; steps only add flow-specific nuance.
const R = {
  coder: "coder",
  planner: "planner",
  reviewer: "reviewer",
  product: "product-specialist",
  architect: "distributed-systems-architect",
}

// Flow-specific nudge for a Reviewer step that gates a review loop: the role's
// own output is a findings report, so we ask it to end with the APPROVE/REVISE
// token the loop matches on.
const REVIEW_LOOP_INSTRUCTION =
  "This step gates a review loop. After your review, finish with a single standalone final line: " +
  "write exactly `APPROVE` when the change is correct, complete, and safe to keep as-is, or `REVISE` " +
  "followed by a numbered list of the specific fixes the implementer must make. The flow loops back to " +
  "the implementer until you APPROVE."

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

// Reusable agent templates (insert into flows as starting points). Each is a
// role on a sensible default provider; everything is editable after inserting.
const builtinAgents: Array<NewAgentConfig & { id: string }> = [
  { id: "agent_planner", name: "Planner", provider: "claude", model: M.claude, effort: "high", role: R.planner, systemPrompt: "", maxIterations: 18, temperature: null },
  { id: "agent_coder", name: "Coder", provider: "ollama", model: M.ollama, effort: "high", role: R.coder, systemPrompt: "", maxIterations: 14, temperature: 0.1 },
  { id: "agent_reviewer", name: "Reviewer", provider: "codex", model: M.codex, effort: "high", role: R.reviewer, systemPrompt: REVIEW_LOOP_INSTRUCTION, maxIterations: 10, temperature: null },
  { id: "agent_product", name: "Product Specialist", provider: "claude", model: M.claude, effort: "high", role: R.product, systemPrompt: "", maxIterations: 16, temperature: null },
  { id: "agent_architect", name: "Distributed Systems Architect", provider: "claude", model: M.claude, effort: "high", role: R.architect, systemPrompt: "", maxIterations: 16, temperature: null },
]

const builtinFlows: Array<NewFlowConfig & { id: string }> = [
  {
    id: "flow_claude",
    name: "Claude Code",
    description: "A single Claude Code agent (Coder), end to end.",
    steps: [step({ id: "s_claude", name: "Claude Code", provider: "claude", model: M.claude, role: R.coder })],
  },
  {
    id: "flow_codex",
    name: "Codex",
    description: "A single Codex agent (Coder, medium effort).",
    steps: [step({ id: "s_codex", name: "Codex", provider: "codex", model: M.codex, role: R.coder, effort: "medium" })],
  },
  {
    id: "flow_ollama",
    name: "Ollama Cloud",
    description: "A single Ollama Cloud agent (Coder) with repo tools.",
    steps: [step({ id: "s_ollama", name: "Ollama", provider: "ollama", model: M.ollama, role: R.coder })],
  },
  {
    id: "flow_plan_build",
    name: "Plan → Build",
    description: "Claude plans, then Ollama implements each plan step with fresh context and completion checks.",
    steps: [
      step({ id: "s_plan", name: "Planner", provider: "claude", model: M.claude, role: R.planner, effort: "high", maxIterations: 18 }),
      step({
        id: "s_build",
        name: "Coder",
        provider: "ollama",
        model: M.ollama,
        role: R.coder,
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
      step({ id: "s_plan", name: "Planner", provider: "claude", model: M.claude, role: R.planner, effort: "high", maxIterations: 18 }),
      step({ id: "s_exec", name: "Coder", provider: "ollama", model: M.ollama, role: R.coder, effort: "high" }),
      step({
        id: "s_review",
        name: "Reviewer",
        provider: "codex",
        model: M.codex,
        role: R.reviewer,
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
      step({ id: "s_oplan", name: "Planner", provider: "ollama", model: M.ollama, role: R.planner, effort: "high" }),
      step({ id: "s_cbuild", name: "Coder", provider: "codex", model: M.codex, role: R.coder, effort: "medium" }),
    ],
  },
  {
    id: "flow_spec_design_build_review",
    name: "Spec → Design → Build → Review",
    description:
      "The full pipeline: a Product Specialist writes the spec, a Distributed Systems Architect designs the approach, Ollama builds it, and Codex reviews — looping back to the build until approved.",
    steps: [
      step({ id: "s_spec", name: "Product Specialist", provider: "claude", model: M.claude, role: R.product, effort: "high", maxIterations: 16 }),
      step({ id: "s_design", name: "Architect", provider: "claude", model: M.claude, role: R.architect, effort: "high", maxIterations: 16 }),
      step({ id: "s_build", name: "Coder", provider: "ollama", model: M.ollama, role: R.coder, effort: "high" }),
      step({
        id: "s_review",
        name: "Reviewer",
        provider: "codex",
        model: M.codex,
        role: R.reviewer,
        effort: "high",
        maxIterations: 10,
        instructions: REVIEW_LOOP_INSTRUCTION,
        loop: { to: "s_build", approveWhen: "APPROVE", maxLoops: 2 },
      }),
    ],
  },
]

export function seedDefaults(): void {
  const version = getSetting<number>("seedVersion")
  const upToDate = version === SEED_VERSION && countAgents() > 0
  if (upToDate) return

  // Refresh built-ins to the current definitions (custom agents/flows are untouched).
  deleteBuiltinFlows()
  deleteBuiltinAgents()

  for (const { id, ...rest } of builtinAgents) {
    createAgent(rest, { id, isBuiltin: true })
  }
  const deletedBuiltinFlowIds = new Set(listDeletedBuiltinFlowIds())
  for (const { id, ...rest } of builtinFlows) {
    if (deletedBuiltinFlowIds.has(id)) continue
    createFlow(rest, { id, isBuiltin: true })
  }

  setSetting("seedVersion", SEED_VERSION)
}
