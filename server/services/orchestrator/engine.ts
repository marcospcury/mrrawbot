import { Annotation, END, START, StateGraph } from "@langchain/langgraph"
import type { FlowConfig, FlowStep, Provider } from "@shared/types.ts"
import { runClaude } from "../providers/claude.ts"
import { runCodex } from "../providers/codex.ts"
import { runOllama } from "../providers/ollama.ts"
import type { ProviderRunner } from "../providers/types.ts"
import { resolveRolePrompt, roleSkillDirs } from "../roles/index.ts"
import type { Emit } from "./events.ts"
import { PLAN_OUTPUT_CONTRACT, parsePlan, type ParsedPlan, type ParsedPlanStep } from "./plan.ts"

const RUNNERS: Record<Provider, ProviderRunner> = {
  claude: runClaude,
  codex: runCodex,
  ollama: runOllama,
}

const OrchState = Annotation.Root({
  task: Annotation<string>(),
  history: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  transcript: Annotation<string>({ reducer: (a, b) => a + b, default: () => "" }),
  outputs: Annotation<Record<string, string>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  iterations: Annotation<Record<string, number>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  finalOutput: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
})
type Orch = typeof OrchState.State

export interface RunFlowContext {
  flow: FlowConfig
  repoPath: string
  repoName: string
  uploadsDir?: string
  /**
   * App-internal folder for this project's design prototypes
   * (`env.designsRoot/<projectId>`). Designer steps create their work here —
   * never inside the repository.
   */
  designWorkspace: string
  /**
   * Pre-rendered `# Attached product-design artifacts` prompt section for the
   * thread's attached artifacts (specs, prototypes, build prompts). Empty or
   * absent when nothing is attached.
   */
  artifactsContext?: string
  emit: Emit
  signal: AbortSignal
  runners?: Partial<Record<Provider, ProviderRunner>>
}

/**
 * The full system prompt for a step: the role's provider-adapted prompt, with
 * the step's own instructions layered on as extra, task-specific guidance. When
 * the step has no role ("custom"), `systemPrompt` is the entire prompt.
 */
export function effectiveSystemPrompt(step: FlowStep): string {
  const base = resolveRolePrompt(step.role, step.provider)
  const extra = step.systemPrompt.trim()
  if (base && extra) return `${base}\n\n# Additional task-specific instructions\n${extra}`
  return base || extra
}

function systemPromptForStep(step: FlowStep, nextStep: FlowStep | null): string {
  const system = effectiveSystemPrompt(step)
  if (nextStep?.mode !== "plan-executor") return system
  const contract = `# Plan output contract\n${PLAN_OUTPUT_CONTRACT}`
  return system.trim() ? `${system}\n\n${contract}` : contract
}

/**
 * Imperative, role-specific directive prepended to the step's user prompt.
 * The system prompt already defines the role, but the task text often reads
 * like a direct implementation request ("build X"); this directive tells the
 * step, in the user channel, exactly what its job is and is not so a planner
 * plans, a reviewer reviews, and only a coder touches files.
 */
const ROLE_STEP_DIRECTIVES: Record<string, string> = {
  coder:
    "You are the CODER step of this run. Implement the task below (following the plan from earlier steps, if one exists) by making the actual changes in the repository, and verify your work.",
  planner:
    "You are the PLANNER step of this run. Your ONLY deliverable is an implementation plan for the task below. Even though the task may be worded as something to implement, you must NOT implement it: do not create, modify, or delete any files. Explore the repository read-only, then output the plan as your final message — a later step will implement it.",
  "heavy-planner":
    "You are the HEAVY PLANNER step of this run. Your ONLY deliverable is an exhaustive, execution-ready implementation plan for the task below. Even though the task may be worded as something to implement, you must NOT implement it: do not create, modify, or delete any files. Investigate the repository read-only until you have evidence for every claim, then output the plan as your final message — a later step (possibly a smaller model) will execute it step by step, so every step must carry its own context, guards, and verification.",
  reviewer:
    "You are the REVIEWER step of this run. Your ONLY deliverable is a review of the work described below: findings with severity and recommended fixes. Do NOT fix anything yourself — do not create, modify, or delete any files.",
  "distributed-systems-architect":
    "You are the ARCHITECT step of this run. Your ONLY deliverable is the architecture/design for the task below. Even though the task may be worded as something to implement, you must NOT implement it: do not create, modify, or delete any files.",
}

function buildPrompt(step: FlowStep, state: Orch, ctx: RunFlowContext): string {
  const sections: string[] = []
  // Every runner receives the role/system prompt through its `system` input
  // and delivers it on its native system channel, replacing the provider's
  // default system prompt. No provider special-casing here.
  const directive = ROLE_STEP_DIRECTIVES[step.role]
  if (directive) sections.push(`# Your job in this step\n${directive}`)
  if (state.history.trim()) {
    sections.push(`# Conversation so far\n${state.history.trim()}`)
  }
  sections.push(`# Your task\n${state.task.trim()}`)
  if (state.transcript.trim()) {
    sections.push(`# Work already done by earlier agents in this flow\n${state.transcript.trim()}`)
  }
  if (ctx.artifactsContext?.trim()) sections.push(ctx.artifactsContext.trim())
  sections.push(repositoryContext(ctx, step.role))
  return sections.join("\n\n")
}

function makeSingleNode(step: FlowStep, ctx: RunFlowContext, nextStep: FlowStep | null) {
  const stepId = step.id
  const runner = ctx.runners?.[step.provider] ?? RUNNERS[step.provider]
  const system = systemPromptForStep(step, nextStep)
  return async (state: Orch): Promise<Partial<Orch>> => {
    const iteration = (state.iterations[stepId] ?? 0) + 1
    ctx.emit({ type: "step_start", stepId, iteration })

    if (ctx.signal.aborted) {
      ctx.emit({ type: "step_end", stepId, status: "error", error: "cancelled" })
      return { iterations: { [stepId]: iteration } }
    }

    const prompt = buildPrompt(step, state, ctx)
    try {
      const result = await runner({
        prompt,
        system,
        model: step.model,
        effort: step.effort,
        fast: step.fast ?? false,
        cwd: ctx.repoPath,
        uploadsDir: ctx.uploadsDir,
        workspaceDir: step.role === "ui-designer" ? ctx.designWorkspace : undefined,
        skillDirs: roleSkillDirs(step.role),
        maxIterations: step.maxIterations,
        temperature: step.temperature,
        signal: ctx.signal,
        onToken: (text) => ctx.emit({ type: "token", stepId, text }),
        onLog: (text) => ctx.emit({ type: "log", stepId, text }),
        onTool: (tool) => ctx.emit({ type: "tool", stepId, tool }),
      })
      const text = result.text?.trim() ? result.text : "(no output)"
      ctx.emit({ type: "step_output", stepId, text })
      ctx.emit({ type: "step_end", stepId, status: "done", usage: result.usage })
      return {
        outputs: { [stepId]: text },
        iterations: { [stepId]: iteration },
        transcript: `\n\n### ${step.name}\n${text}`,
        finalOutput: text,
      }
    } catch (err) {
      const message = (err as Error).message ?? String(err)
      ctx.emit({ type: "step_end", stepId, status: "error", error: message })
      throw new Error(`Step "${step.name}" failed: ${message}`)
    }
  }
}

function makePlanExecutorNode(step: FlowStep, ctx: RunFlowContext, prevStep: FlowStep | null) {
  const stepId = step.id
  const runner = ctx.runners?.[step.provider] ?? RUNNERS[step.provider]
  const system = effectiveSystemPrompt(step)
  return async (state: Orch): Promise<Partial<Orch>> => {
    const iteration = (state.iterations[stepId] ?? 0) + 1
    ctx.emit({ type: "step_start", stepId, iteration })
    if (ctx.signal.aborted) {
      ctx.emit({ type: "step_end", stepId, status: "error", error: "cancelled" })
      return { iterations: { [stepId]: iteration } }
    }

    const planText = (prevStep ? state.outputs[prevStep.id] : "") || state.finalOutput || state.task
    const parsed = parsePlan(planText)
    if (!parsed || parsed.steps.length === 0) {
      ctx.emit({
        type: "log",
        stepId,
        text: "No structured plan found; running this step once with the full previous plan.",
      })
      return runPlanFallback({ step, state, ctx, runner, system, iteration })
    }

    try {
      const summaries: string[] = []
      let finalCheckerOutput = ""
      let currentPlan: ParsedPlan = parsed
      const maxPasses = Math.max(1, step.maxCompletionPasses ?? 10)

      await runPlanSteps({ step, ctx, runner, system, plan: currentPlan, round: 1, summaries })

      for (let pass = 1; pass <= maxPasses; pass++) {
        const check = await runCompletionCheck({ step, ctx, runner, system, plan: parsed, summaries, pass })
        finalCheckerOutput = check.output
        if (check.missing.steps.length === 0) {
          const finalText = buildPlanExecutorFinal(finalCheckerOutput, summaries)
          ctx.emit({ type: "step_output", stepId, text: finalText })
          ctx.emit({ type: "step_end", stepId, status: "done", usage: null })
          return {
            outputs: { [stepId]: finalText },
            iterations: { [stepId]: iteration },
            transcript: `\n\n### ${step.name}\n${summaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
            finalOutput: finalText,
          }
        }
        currentPlan = { summary: parsed.summary, steps: check.missing.steps }
        await runPlanSteps({ step, ctx, runner, system, plan: currentPlan, round: pass + 1, summaries })
      }

      const finalText = buildPlanExecutorFinal(
        `${finalCheckerOutput}\n\nReached the completion-pass safety ceiling (${maxPasses}).`,
        summaries,
      )
      ctx.emit({ type: "step_output", stepId, text: finalText })
      ctx.emit({ type: "step_end", stepId, status: "done", usage: null })
      return {
        outputs: { [stepId]: finalText },
        iterations: { [stepId]: iteration },
        transcript: `\n\n### ${step.name}\n${summaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
        finalOutput: finalText,
      }
    } catch (err) {
      const message = (err as Error).message ?? String(err)
      ctx.emit({ type: "step_end", stepId, status: "error", error: message })
      throw new Error(`Step "${step.name}" failed: ${message}`)
    }
  }
}

async function runPlanFallback({
  step,
  state,
  ctx,
  runner,
  system,
  iteration,
}: {
  step: FlowStep
  state: Orch
  ctx: RunFlowContext
  runner: ProviderRunner
  system: string
  iteration: number
}): Promise<Partial<Orch>> {
  const stepId = step.id
  const prompt = buildPrompt(step, state, ctx)
  const result = await runner({
    prompt,
    system,
    model: step.model,
    effort: step.effort,
    fast: step.fast ?? false,
    cwd: ctx.repoPath,
    uploadsDir: ctx.uploadsDir,
    workspaceDir: step.role === "ui-designer" ? ctx.designWorkspace : undefined,
    skillDirs: roleSkillDirs(step.role),
    maxIterations: step.maxIterations,
    temperature: step.temperature,
    signal: ctx.signal,
    onToken: (text) => ctx.emit({ type: "token", stepId, text }),
    onLog: (text) => ctx.emit({ type: "log", stepId, text }),
    onTool: (tool) => ctx.emit({ type: "tool", stepId, tool }),
  })
  const text = result.text?.trim() ? result.text : "(no output)"
  ctx.emit({ type: "step_output", stepId, text })
  ctx.emit({ type: "step_end", stepId, status: "done", usage: result.usage })
  return {
    outputs: { [stepId]: text },
    iterations: { [stepId]: iteration },
    transcript: `\n\n### ${step.name}\n${text}`,
    finalOutput: text,
  }
}

async function runPlanSteps({
  step,
  ctx,
  runner,
  system,
  plan,
  round,
  summaries,
}: {
  step: FlowStep
  ctx: RunFlowContext
  runner: ProviderRunner
  system: string
  plan: ParsedPlan
  round: number
  summaries: string[]
}) {
  for (let i = 0; i < plan.steps.length; i++) {
    const planStep = plan.steps[i]
    const subStepId = `${step.id}#${round}.${i + 1}`
    ctx.emit({
      type: "step_start",
      stepId: subStepId,
      iteration: 1,
      title: `Build ${i + 1}/${plan.steps.length} — ${planStep.title}`,
      provider: step.provider,
      model: step.model,
      effort: step.effort,
    })
    try {
      const prompt = buildPlanStepPrompt({ ctx, role: step.role, plan, planStep, index: i, summaries })
      const result = await runner({
        prompt,
        system,
        model: step.model,
        effort: step.effort,
        fast: step.fast ?? false,
        cwd: ctx.repoPath,
        uploadsDir: ctx.uploadsDir,
        workspaceDir: step.role === "ui-designer" ? ctx.designWorkspace : undefined,
        skillDirs: roleSkillDirs(step.role),
        maxIterations: step.maxIterations,
        temperature: step.temperature,
        signal: ctx.signal,
        onToken: (text) => ctx.emit({ type: "token", stepId: subStepId, text }),
        onLog: (text) => ctx.emit({ type: "log", stepId: subStepId, text }),
        onTool: (tool) => ctx.emit({ type: "tool", stepId: subStepId, tool }),
      })
      const text = result.text?.trim() ? result.text : "(no output)"
      const summary = completionSummary(text, planStep)
      summaries.push(summary)
      ctx.emit({ type: "step_output", stepId: subStepId, text })
      ctx.emit({ type: "step_end", stepId: subStepId, status: "done", usage: result.usage })
    } catch (err) {
      const message = (err as Error).message ?? String(err)
      ctx.emit({ type: "step_end", stepId: subStepId, status: "error", error: message })
      throw err
    }
  }
}

async function runCompletionCheck({
  step,
  ctx,
  runner,
  system,
  plan,
  summaries,
  pass,
}: {
  step: FlowStep
  ctx: RunFlowContext
  runner: ProviderRunner
  system: string
  plan: ParsedPlan
  summaries: string[]
  pass: number
}): Promise<{ output: string; missing: ParsedPlan }> {
  const subStepId = `${step.id}#check.${pass}`
  ctx.emit({
    type: "step_start",
    stepId: subStepId,
    iteration: 1,
    title: `Completion check (pass ${pass})`,
    provider: step.provider,
    model: step.model,
    effort: step.effort,
  })
  try {
    const prompt = buildCompletionCheckPrompt({ ctx, role: step.role, plan, summaries })
    const result = await runner({
      prompt,
      system,
      model: step.model,
      effort: step.effort,
      fast: step.fast ?? false,
      cwd: ctx.repoPath,
      uploadsDir: ctx.uploadsDir,
      skillDirs: roleSkillDirs(step.role),
      maxIterations: step.maxIterations,
      temperature: step.temperature,
      signal: ctx.signal,
      onToken: (text) => ctx.emit({ type: "token", stepId: subStepId, text }),
      onLog: (text) => ctx.emit({ type: "log", stepId: subStepId, text }),
      onTool: (tool) => ctx.emit({ type: "tool", stepId: subStepId, tool }),
    })
    const output = result.text?.trim() ? result.text : "(no output)"
    const missing = parsePlan(output) ?? { summary: plan.summary, steps: [] }
    ctx.emit({ type: "step_output", stepId: subStepId, text: output })
    ctx.emit({ type: "step_end", stepId: subStepId, status: "done", usage: result.usage })
    return { output, missing }
  } catch (err) {
    const message = (err as Error).message ?? String(err)
    ctx.emit({ type: "step_end", stepId: subStepId, status: "error", error: message })
    throw err
  }
}

function buildPlanStepPrompt({
  ctx,
  role,
  plan,
  planStep,
  index,
  summaries,
}: {
  ctx: RunFlowContext
  role: string
  plan: ParsedPlan
  planStep: ParsedPlanStep
  index: number
  summaries: string[]
}) {
  return [
    `# Big picture\n${plan.summary}`,
    `# Overall plan (titles only)\n${plan.steps
      .map((s, i) => `${i + 1}. ${i === index ? "[current] " : ""}${s.title}`)
      .join("\n")}`,
    `# Already completed\n${summaries.length ? summaries.map((s, i) => `${i + 1}. ${s}`).join("\n") : "None yet."}`,
    `# Your task — step ${planStep.id}: ${planStep.title}\n${planStep.prompt}${
      planStep.verify ? `\n\nVerify this step with: ${planStep.verify}` : ""
    }\n\nEnd your response with a final line exactly like: DONE: one line of what changed.`,
    ...(ctx.artifactsContext?.trim() ? [ctx.artifactsContext.trim()] : []),
    repositoryContext(ctx, role),
  ].join("\n\n")
}

function buildCompletionCheckPrompt({
  ctx,
  role,
  plan,
  summaries,
}: {
  ctx: RunFlowContext
  role: string
  plan: ParsedPlan
  summaries: string[]
}) {
  return [
    `# Big picture\n${plan.summary}`,
    `# Full step list\n${plan.steps.map((s) => `${s.id}. ${s.title}\n${s.prompt}`).join("\n\n")}`,
    `# Completion summaries\n${summaries.length ? summaries.map((s, i) => `${i + 1}. ${s}`).join("\n") : "None."}`,
    "Inspect the repository. List anything from the plan that is missing or incomplete as a `plan-json` block with the same schema. Use an empty `steps` array when the plan is fully implemented. Implement nothing yet.",
    repositoryContext(ctx, role),
  ].join("\n\n")
}

function repositoryContext(ctx: RunFlowContext, role?: string): string {
  if (role === "ui-designer") {
    return (
      `# Repository & workspace context\nYou are designing for the repository "${ctx.repoName}" located at ${ctx.repoPath}.` +
      " Read anything in it to ground your design — its design system, domain vocabulary, and existing screens — but treat it as strictly read-only." +
      `\n\nYour design workspace is ${ctx.designWorkspace} — an app-managed folder outside the repository.` +
      ` Create your prototype in a new folder ${ctx.designWorkspace}/<kebab-case-slug>/ named for this assignment` +
      " (iterate in place only when the task asks you to revise an existing prototype there)." +
      " The user browses this workspace in the app's Design tab."
    )
  }
  return (
    `# Repository context\nYou are operating on the repository "${ctx.repoName}" located at ${ctx.repoPath}.` +
    " You have full access to read, modify, create, and run anything in this repository."
  )
}

function completionSummary(text: string, step: ParsedPlanStep): string {
  const done = [...text.matchAll(/^DONE:\s*(.+)$/gim)].at(-1)?.[1]?.trim()
  if (done) return done
  return `${step.title}: ${text.split(/\n+/).find((line) => line.trim())?.trim().slice(0, 180) ?? "completed"}`
}

function buildPlanExecutorFinal(checkerOutput: string, summaries: string[]): string {
  return [`# Completion check\n${checkerOutput.trim()}`, `# Completed work\n${summaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}`].join("\n\n")
}

/** The ordered, de-duplicated steps a flow will execute (ids are unique node keys). */
export function resolveFlowSteps(flow: FlowConfig): FlowStep[] {
  const seen = new Set<string>()
  const out: FlowStep[] = []
  for (const step of flow.steps) {
    if (step.id && !seen.has(step.id)) {
      seen.add(step.id)
      out.push(step)
    }
  }
  return out
}

/** Validate + assemble a StateGraph at runtime from the flow's self-contained steps. */
export function buildFlowGraph(ctx: RunFlowContext) {
  const steps = resolveFlowSteps(ctx.flow)
  if (steps.length === 0) throw new Error("Flow has no steps. Add at least one step to the flow.")
  const stepIds = new Set(steps.map((s) => s.id))

  // Loosely typed because node names are dynamic (data-driven graph).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = new StateGraph(OrchState) as any

  steps.forEach((step, index) => {
    const prevStep = index > 0 ? steps[index - 1] : null
    const nextStep = index < steps.length - 1 ? steps[index + 1] : null
    g.addNode(
      step.id,
      step.mode === "plan-executor"
        ? makePlanExecutorNode(step, ctx, prevStep)
        : makeSingleNode(step, ctx, nextStep),
    )
  })

  g.addEdge(START, steps[0].id)

  steps.forEach((step, i) => {
    const id = step.id
    const next = i === steps.length - 1 ? END : steps[i + 1].id
    const loop = step.loop && stepIds.has(step.loop.to) ? step.loop : null
    if (loop) {
      g.addConditionalEdges(id, (state: Orch) => {
        const iter = state.iterations[id] ?? 0
        const out = (state.outputs[id] ?? "").toLowerCase()
        const approved = loop.approveWhen ? out.includes(loop.approveWhen.toLowerCase()) : false
        if (approved || iter >= loop.maxLoops) return next
        return loop.to
      })
    } else {
      g.addEdge(id, next)
    }
  })

  return g.compile()
}

export interface RunFlowInput {
  flow: FlowConfig
  repoPath: string
  repoName: string
  uploadsDir?: string
  /** App-internal design-prototype folder for the project (see RunFlowContext). */
  designWorkspace: string
  /** Attached-artifacts prompt section (see RunFlowContext). */
  artifactsContext?: string
  task: string
  history: string
  emit: Emit
  signal: AbortSignal
  runners?: Partial<Record<Provider, ProviderRunner>>
}

/** Run a flow end-to-end; returns the final step output. */
export async function runFlow(input: RunFlowInput): Promise<string> {
  const ctx: RunFlowContext = {
    flow: input.flow,
    repoPath: input.repoPath,
    repoName: input.repoName,
    uploadsDir: input.uploadsDir,
    designWorkspace: input.designWorkspace,
    artifactsContext: input.artifactsContext,
    emit: input.emit,
    signal: input.signal,
    runners: input.runners,
  }
  const graph = buildFlowGraph(ctx)
  const result = (await graph.invoke(
    { task: input.task, history: input.history },
    { recursionLimit: 50, signal: input.signal },
  )) as Orch
  return result.finalOutput || result.task
}
