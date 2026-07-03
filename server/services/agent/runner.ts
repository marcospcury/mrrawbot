import {
  AgentRunner,
  finalizeRunEvents,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "@copilotkit/runtime/v2"
import { EventType, type BaseEvent } from "@ag-ui/core"
import { Observable, Subject } from "rxjs"
import { listMessages } from "../../db/repos/messages.ts"

interface LiveRun {
  agent: AgentRunnerRunRequest["agent"]
  /** Replays the compacted event history, then streams live events. */
  stream: Observable<BaseEvent>
  stopRequested: boolean
  /** Resolves when the agent run has fully settled (success or error). */
  done: Promise<void>
}

/**
 * SQLite-backed AgentRunner. The stock InMemoryAgentRunner keeps thread history
 * in process memory, so reconnecting to a thread replays a different (often
 * stale or empty) history than what the app persists in SQLite — and the two
 * hydration paths fight over the client's message list. This runner makes the
 * DB the single source of truth:
 *
 * - connect() replays the thread's persisted messages as one synthetic run,
 *   then attaches to the live event stream if a run is currently in flight
 *   (so a re-opened thread picks the progress UI back up mid-run).
 * - run() takes over a still-running stale run (aborting it) instead of
 *   throwing "Thread already running" — with a single local user, a new
 *   message on a busy thread always means the old run was abandoned.
 *
 * Finished-run state snapshots are intentionally NOT replayed on connect: the
 * app renders persisted run timelines itself from the agent_runs table.
 */
export class MrrawbotAgentRunner extends AgentRunner {
  private live = new Map<string, LiveRun>()

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const { threadId, agent, input } = request
    const subject = new Subject<BaseEvent>()
    // Compacted event history used both for late-subscriber replay and for
    // finalizeRunEvents. STATE_SNAPSHOTs are cumulative, so only the latest
    // one is kept — an unbounded buffer would otherwise grow by one full
    // snapshot every ~90ms for the whole run.
    const events: BaseEvent[] = []
    // Ids already persisted for this thread — the new user message is not
    // among them yet (the agent saves it once the run starts), so it survives
    // this filter and reaches late-connecting clients via RUN_STARTED.input.
    const persistedIds = new Set(listMessages(threadId).map((m) => m.id))

    let completed = false
    // Replay the compacted history synchronously, then attach live. push() and
    // subscription both run on the single JS thread, so no event can slip
    // between the replay loop and the subscribe call.
    const stream = new Observable<BaseEvent>((subscriber) => {
      for (const event of events) subscriber.next(event)
      if (completed) {
        subscriber.complete()
        return
      }
      return subject.subscribe(subscriber)
    })

    const liveRun: LiveRun = {
      agent,
      stream,
      stopRequested: false,
      done: Promise.resolve(),
    }

    const push = (event: BaseEvent) => {
      let processed = event
      if (event.type === EventType.RUN_STARTED && !(event as { input?: unknown }).input) {
        const messages = input.messages?.filter((m) => !persistedIds.has(m.id))
        processed = { ...event, input: { ...input, ...(messages ? { messages } : {}) } } as BaseEvent
      }
      if (processed.type === EventType.STATE_SNAPSHOT) {
        const prev = events.findIndex((e) => e.type === EventType.STATE_SNAPSHOT)
        if (prev >= 0) events.splice(prev, 1)
      }
      events.push(processed)
      subject.next(processed)
    }

    liveRun.done = (async () => {
      // Take over a stale run: a new message on a busy thread means the
      // previous run was abandoned (e.g. the window was closed mid-run).
      const previous = this.live.get(threadId)
      if (previous) {
        previous.stopRequested = true
        previous.agent.abortRun()
        // Aborts propagate through the flow's AbortSignal, so the old run
        // settles quickly; the timeout only guards against a hung provider.
        await Promise.race([previous.done, new Promise((r) => setTimeout(r, 15_000))])
      }
      this.live.set(threadId, liveRun)

      try {
        await agent.runAgent(input, { onEvent: ({ event }) => push(event) })
        for (const event of finalizeRunEvents(events, { stopRequested: liveRun.stopRequested })) {
          events.push(event)
          subject.next(event)
        }
      } catch (error) {
        const interruptionMessage = error instanceof Error ? error.message : String(error)
        for (const event of finalizeRunEvents(events, {
          stopRequested: liveRun.stopRequested,
          interruptionMessage,
        })) {
          events.push(event)
          subject.next(event)
        }
      } finally {
        if (this.live.get(threadId) === liveRun) this.live.delete(threadId)
        completed = true
        subject.complete()
      }
    })()

    return stream
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const { threadId } = request
    const current = this.live.get(threadId)
    const messages = listMessages(threadId)
    const historyIds = new Set(messages.map((m) => m.id))

    return new Observable<BaseEvent>((out) => {
      if (messages.length > 0) {
        const runId = `${threadId}-history`
        out.next({
          type: EventType.RUN_STARTED,
          threadId,
          runId,
          input: {
            threadId,
            runId,
            messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
            tools: [],
            context: [],
            state: {},
            forwardedProps: {},
          },
        } as unknown as BaseEvent)
        out.next({ type: EventType.RUN_FINISHED, threadId, runId } as unknown as BaseEvent)
      }

      if (!current) {
        out.complete()
        return
      }
      // A run is in flight: stream it from the start so the client rebuilds
      // the in-progress state. Skip message events already covered by the
      // history replay (the run may have persisted them just before we read).
      return current.stream.subscribe({
        next: (event) => {
          const messageId = (event as { messageId?: unknown }).messageId
          if (typeof messageId === "string" && historyIds.has(messageId)) return
          out.next(event)
        },
        complete: () => out.complete(),
        error: (err) => out.error(err),
      })
    })
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    const current = this.live.get(request.threadId)
    return Promise.resolve(!!current && !current.stopRequested)
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean> {
    const current = this.live.get(request.threadId)
    if (!current || current.stopRequested) return Promise.resolve(false)
    current.stopRequested = true
    current.agent.abortRun()
    return Promise.resolve(true)
  }
}
