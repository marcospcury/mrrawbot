import { AbstractAgent, type RunAgentInput } from "@ag-ui/client"
import { EventType, type BaseEvent } from "@ag-ui/core"
import { Observable } from "rxjs"
import { randomUUID } from "node:crypto"
import {
  DEFAULT_ROLE_ID,
  defaultSession,
  roleInfo,
  type AgentRunState,
  type FlowConfig,
  type ProductDesignPersona,
  type RunStep,
  type SessionConfig,
} from "@shared/types.ts"
import { getFlow } from "../../db/repos/flows.ts"
import { getProject } from "../../db/repos/projects.ts"
import { saveRun } from "../../db/repos/runs.ts"
import { saveMessage } from "../../db/repos/messages.ts"
import { autoNameThread, getThread, threadCanAutoName, touchThread } from "../../db/repos/threads.ts"
import { providerLabel, unconfiguredProviders } from "../providers/status.ts"
import { resolveFlowSteps, runFlow } from "../orchestrator/engine.ts"
import { runProductDesignTurn } from "../orchestrator/productDesign.ts"
import type { OrchEvent } from "../orchestrator/events.ts"
import { buildArtifactContext } from "../artifactContext.ts"
import { createChangeTracker } from "../changeTracker.ts"
import { createArtifactTracker, projectArtifactsDir, type ArtifactTracker } from "../artifacts.ts"
import { threadUploadsDir } from "../uploads.ts"
import { generateThreadTitle } from "../threadTitles.ts"

// Fallback used only when a session carries an unknown role id; a valid role
// (the default is Coder) supplies the system prompt via the role registry.
const ADHOC_SYSTEM_PROMPT =
  "You are an expert pair programmer operating directly in the repository. Understand the request, " +
  "inspect the relevant code, and deliver a precise, correct, and complete result. Keep working until " +
  "the task is fully done — don't stop early or hand back a partial answer."

/** Build a synthetic single-step flow from a quick-run session config. */
function singleAgentFlow(session: SessionConfig): FlowConfig {
  const ts = new Date().toISOString()
  const role = session.role || DEFAULT_ROLE_ID
  const roleLabel = roleInfo(role)?.name
  const label = providerLabel(session.provider) + (session.model ? ` · ${session.model}` : "")
  return {
    id: "adhoc",
    name: label,
    description: "Single-agent quick run",
    isBuiltin: true,
    createdAt: ts,
    updatedAt: ts,
    steps: [
      {
        id: "adhoc",
        name: roleLabel ? `${providerLabel(session.provider)} · ${roleLabel}` : providerLabel(session.provider),
        provider: session.provider,
        model: session.model,
        effort: session.effort,
        fast: session.fast ?? false,
        role,
        // The role supplies the system prompt; fall back to a generic prompt
        // only if the role id is unknown (so it resolves to nothing).
        systemPrompt: roleInfo(role) ? "" : ADHOC_SYSTEM_PROMPT,
        // Generous turn budget for Claude/Codex; the Ollama loop runs until done regardless.
        maxIterations: 100,
        temperature: null,
        mode: "single",
        maxCompletionPasses: 10,
        loop: null,
      },
    ],
  }
}

interface AGMessage {
  id?: string
  role?: string
  content?: unknown
}

function contentToString(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : (c as { text?: string })?.text ?? ""))
      .join("")
  }
  return ""
}

function emptyUsage() {
  return null
}

async function autoNameThreadAfterRun(input: {
  threadId: string
  task: string
  history: string
  finalText: string
  signal: AbortSignal
}): Promise<void> {
  if (!threadCanAutoName(input.threadId)) return
  try {
    const signal =
      typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.any([input.signal, AbortSignal.timeout(10_000)])
        : input.signal
    const title = await generateThreadTitle({
      task: input.task,
      history: input.history,
      finalAnswer: input.finalText,
      signal,
    })
    if (title) autoNameThread(input.threadId, title)
  } catch {
    // Naming is convenience-only; never fail or delay recovery of the actual run.
  }
}

export class MrrawbotAgent extends AbstractAgent {
  // AbortController of the in-flight run; each request runs on its own agent
  // clone, so there is at most one. Lets the runner cancel via abortRun().
  private runAbort: AbortController | null = null

  abortRun(): void {
    this.runAbort?.abort()
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      let cancelled = false
      const ac = new AbortController()
      this.runAbort = ac
      const emit = (e: BaseEvent) => {
        if (!cancelled) observer.next(e)
      }

      const messages = (input.messages ?? []) as AGMessage[]
      const threadId = input.threadId
      const runId = input.runId ?? randomUUID()
      const forwarded = (input.forwardedProps ?? {}) as Record<string, unknown>

      // ---- throttled STATE_SNAPSHOT emitter ----
      let runState: AgentRunState | null = null
      let changeTracker: Awaited<ReturnType<typeof createChangeTracker>> | null = null
      let artifactTracker: ArtifactTracker | null = null
      let pending = false
      let timer: ReturnType<typeof setTimeout> | null = null
      let savedMessageId: string | null = null
      let lastSaveAt = 0
      const flushState = (persist = true) => {
        pending = false
        if (runState) {
          // Persist the run as it progresses so quitting the app mid-run
          // doesn't lose the execution from the thread's history — but not on
          // every token flush: the state JSON grows with the run, so rewriting
          // it every 90ms is quadratic in run length. Step boundaries persist
          // unconditionally; token ticks ride a 2s heartbeat.
          if (persist || Date.now() - lastSaveAt > 2000) {
            saveRun(runState, savedMessageId)
            lastSaveAt = Date.now()
          }
          emit({ type: EventType.STATE_SNAPSHOT, snapshot: runState } as unknown as BaseEvent)
        }
      }
      const scheduleState = (immediate = false) => {
        if (immediate) {
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
          flushState()
          return
        }
        if (pending) return
        pending = true
        timer = setTimeout(() => {
          timer = null
          flushState(false)
        }, 90)
      }

      ;(async () => {
        emit({ type: EventType.RUN_STARTED, threadId, runId } as unknown as BaseEvent)

        // Resolve thread -> project -> repo + flow (DB is the source of truth).
        const thread = getThread(threadId)
        if (!thread) {
          throw new Error("Thread not found. Create the thread before chatting.")
        }
        const project = getProject(thread.projectId)
        if (!project) throw new Error("Project not found for this thread.")
        changeTracker = await createChangeTracker({ threadId, runId, repoPath: project.repoPath })
        artifactTracker = await createArtifactTracker({ projectId: project.id, threadId, runId })
        const uploadsDir = threadUploadsDir(project.id, threadId)

        const isProductDesign = thread.kind === "product-design"
        const session =
          (forwarded.session as SessionConfig | undefined) ?? thread.session ?? defaultSession()

        // The chat header forwards the live run config. A flowId means "flow mode";
        // a null/absent flowId means "single-agent quick run" driven by the session.
        // Product Design sessions never run flows.
        let flow: FlowConfig | null = null
        if (!isProductDesign) {
          const flowId =
            "flowId" in forwarded ? (forwarded.flowId as string | null) : thread.flowId
          if (flowId) {
            const loaded = getFlow(flowId)
            if (!loaded) throw new Error("Selected flow no longer exists.")
            flow = loaded
          } else {
            flow = singleAgentFlow(session)
          }
          if (resolveFlowSteps(flow).length === 0) throw new Error(`Flow "${flow.name}" has no steps.`)
        }
        const orderedSteps = flow ? resolveFlowSteps(flow) : []

        // Fail fast (before any step runs) when the run needs providers that
        // aren't set up. The flow stays selectable — it just can't run until
        // the providers are configured or swapped for available ones.
        const missing = unconfiguredProviders(
          isProductDesign ? [session.provider] : orderedSteps.map((s) => s.provider),
        )
        if (missing.length > 0) {
          const names = missing.map(providerLabel).join(", ")
          throw new Error(
            `This run needs providers that aren't set up yet: ${names}. ` +
              `Configure them in Settings → Providers, or switch to a different provider.`,
          )
        }

        const lastUser = [...messages].reverse().find((m) => m.role === "user")
        const task = contentToString(lastUser?.content).trim()
        if (!task) throw new Error("Empty message.")

        // Persist the user message.
        saveMessage({
          id: lastUser?.id ?? randomUUID(),
          threadId,
          role: "user",
          content: task,
        })
        touchThread(threadId)

        // Build conversation history from earlier messages.
        const priorMessages = messages.filter((m) => m !== lastUser && (m.role === "user" || m.role === "assistant"))
        const history = priorMessages
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${contentToString(m.content).trim()}`)
          .filter((l) => l.length > 6)
          .slice(-12)
          .join("\n\n")

        // Auto-name the thread as soon as its first user message lands —
        // waiting for the run to finish leaves "New thread" up for the whole
        // run. The post-run call below is only a retry with richer context.
        const earlyAutoNaming = autoNameThreadAfterRun({ threadId, task, history, finalText: "", signal: ac.signal })

        // Initial run state with every step pending. Product Design turns start
        // with no pre-declared steps — persona steps are synthesized from
        // step_start events as the router picks them.
        const finalStepId = orderedSteps.length > 0 ? orderedSteps[orderedSteps.length - 1].id : ""
        const steps: RunStep[] = orderedSteps.map((s) => ({
          id: s.id,
          agentName: s.name,
          provider: s.provider,
          model: s.model,
          effort: s.effort,
          title: s.name,
          status: "pending",
          output: "",
          logs: [],
          iteration: 0,
          isFinal: s.id === finalStepId,
          error: null,
          usage: emptyUsage(),
          startedAt: null,
          endedAt: null,
        }))
        runState = {
          runId,
          threadId,
          flowId: flow?.id ?? null,
          flowName: flow?.name ?? "Product Design",
          status: "running",
          steps,
          activeStepId: null,
          startedAt: Date.now(),
          endedAt: null,
          error: null,
        }
        const stepById = new Map(steps.map((s) => [s.id, s]))
        scheduleState(true)

        // ---- map orchestrator events into run state + AG-UI snapshots ----
        const getStep = (ev: OrchEvent): RunStep | undefined => {
          const existing = stepById.get(ev.stepId)
          if (existing) return existing
          if (!runState) return undefined
          // Synthesize steps that weren't pre-declared: plan-executor sub-steps
          // ("<parent>#<n>", inheriting the parent's config) and top-level
          // Product Design persona steps (announced entirely by their
          // step_start event).
          const parent = ev.stepId.includes("#") ? stepById.get(ev.stepId.split("#")[0]) : undefined
          if (!parent && ev.type !== "step_start") return undefined
          const step: RunStep = {
            id: ev.stepId,
            agentName: ev.type === "step_start" ? ev.title ?? ev.stepId : ev.stepId,
            provider: (ev.type === "step_start" ? ev.provider ?? parent?.provider : parent?.provider) ?? "claude",
            model: (ev.type === "step_start" ? ev.model ?? parent?.model : parent?.model) ?? "",
            effort: (ev.type === "step_start" ? ev.effort ?? parent?.effort : parent?.effort) ?? null,
            title: ev.type === "step_start" ? ev.title ?? ev.stepId : ev.stepId,
            status: "pending",
            output: "",
            logs: [],
            iteration: 0,
            isFinal: false,
            error: null,
            usage: emptyUsage(),
            startedAt: null,
            endedAt: null,
          }
          stepById.set(ev.stepId, step)
          runState.steps.push(step)
          return step
        }

        const onOrch = (ev: OrchEvent) => {
          const step = getStep(ev)
          if (!step || !runState) return
          switch (ev.type) {
            case "step_start":
              if (ev.title) {
                step.agentName = ev.title
                step.title = ev.title
              }
              if (ev.provider) step.provider = ev.provider
              if (ev.model !== undefined) step.model = ev.model
              if (ev.effort !== undefined) step.effort = ev.effort
              step.status = "running"
              step.iteration = ev.iteration
              step.startedAt = step.startedAt ?? Date.now()
              if (ev.iteration > 1) step.output = "" // fresh pass on loop-back
              runState.activeStepId = step.id
              scheduleState(true)
              break
            case "token":
              step.output += ev.text
              scheduleState()
              break
            case "log":
              step.logs.push(ev.text)
              if (step.logs.length > 200) step.logs.shift()
              scheduleState()
              break
            case "tool": {
              const { name, args, result } = ev.tool
              if (args !== undefined) changeTracker?.onToolObserved(name, args)
              if (result !== undefined) step.logs.push(`✓ ${name}`)
              else step.logs.push(`→ ${name}(${JSON.stringify(args ?? {}).slice(0, 100)})`)
              if (step.logs.length > 200) step.logs.shift()
              scheduleState()
              break
            }
            case "step_output":
              step.output = ev.text
              scheduleState(true)
              break
            case "step_end":
              step.status = ev.status === "error" ? "error" : "done"
              step.error = ev.error ?? null
              step.usage = ev.usage ?? null
              step.endedAt = Date.now()
              scheduleState(true)
              break
          }
        }

        let finalText: string
        if (isProductDesign) {
          const persona = (forwarded.persona as ProductDesignPersona | undefined) ?? "auto"
          finalText = await runProductDesignTurn({
            projectId: project.id,
            repoPath: project.repoPath,
            repoName: project.repoName,
            uploadsDir,
            artifactsWorkspace: projectArtifactsDir(project.id),
            session,
            persona,
            task,
            history,
            emit: onOrch,
            signal: ac.signal,
          })
        } else {
          finalText = await runFlow({
            flow: flow!,
            repoPath: project.repoPath,
            repoName: project.repoName,
            uploadsDir,
            designWorkspace: projectArtifactsDir(project.id),
            artifactsContext: await buildArtifactContext(threadId),
            task,
            history,
            emit: onOrch,
            signal: ac.signal,
          })
        }

        await changeTracker.finish()
        changeTracker = null
        const landedArtifacts = await artifactTracker.finish()
        artifactTracker = null
        if (landedArtifacts.length > 0) runState.artifacts = landedArtifacts

        if (cancelled) return

        // Emit the clean final answer as one assistant text message.
        const assistantMsgId = randomUUID()
        emit({ type: EventType.TEXT_MESSAGE_START, messageId: assistantMsgId, role: "assistant" } as unknown as BaseEvent)
        emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: assistantMsgId, delta: finalText } as unknown as BaseEvent)
        emit({ type: EventType.TEXT_MESSAGE_END, messageId: assistantMsgId } as unknown as BaseEvent)

        runState.status = "done"
        runState.activeStepId = null
        runState.endedAt = Date.now()
        savedMessageId = assistantMsgId
        scheduleState(true)

        saveMessage({ id: assistantMsgId, threadId, role: "assistant", content: finalText, runId })
        saveRun(runState, assistantMsgId)
        await earlyAutoNaming
        await autoNameThreadAfterRun({ threadId, task, history, finalText, signal: ac.signal })

        emit({ type: EventType.RUN_FINISHED, threadId, runId } as unknown as BaseEvent)
        observer.complete()
      })().catch((err) => {
        ;(async () => {
          if (changeTracker) {
            await changeTracker.finish()
            changeTracker = null
          }
          if (artifactTracker) {
            const landedArtifacts = await artifactTracker.finish()
            artifactTracker = null
            if (runState && landedArtifacts.length > 0) runState.artifacts = landedArtifacts
          }
          const message = (err as Error)?.message ?? String(err)
          if (runState) {
            runState.status = cancelled || ac.signal.aborted ? "cancelled" : "error"
            runState.error = message
            runState.endedAt = Date.now()
            runState.activeStepId = null
            // Close out steps caught mid-flight so rehydrated timelines don't
            // render a live spinner and a forever-ticking duration.
            for (const step of runState.steps) {
              if (step.status === "running") {
                step.status = runState.status === "cancelled" ? "skipped" : "error"
                step.endedAt = Date.now()
              }
            }
            flushState()
            saveRun(runState, null)
          }
          emit({ type: EventType.RUN_ERROR, message } as unknown as BaseEvent)
          observer.error(err)
        })().catch((finishErr) => {
          const message = (finishErr as Error)?.message ?? String(finishErr)
          emit({ type: EventType.RUN_ERROR, message } as unknown as BaseEvent)
          observer.error(finishErr)
        })
      })

      return () => {
        cancelled = true
        if (timer) clearTimeout(timer)
        ac.abort()
      }
    })
  }
}
