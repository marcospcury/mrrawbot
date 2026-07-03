import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { firstValueFrom, toArray } from "rxjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EventType, type BaseEvent } from "@ag-ui/core"
import type { AgentRunnerRunRequest } from "@copilotkit/runtime/v2"

type RunnerAgent = AgentRunnerRunRequest["agent"]

/** Minimal stand-in for the per-request agent clone the runtime hands the runner. */
function fakeAgent(events: BaseEvent[], opts: { settle?: () => Promise<void> } = {}): RunnerAgent {
  return {
    async runAgent(_input: unknown, { onEvent }: { onEvent: (p: { event: BaseEvent }) => void }) {
      for (const event of events) onEvent({ event })
      await opts.settle?.()
    },
    abortRun: vi.fn(),
  } as unknown as RunnerAgent
}

function collect(observable: { pipe: (op: unknown) => unknown }): Promise<BaseEvent[]> {
  return firstValueFrom((observable as ReturnType<typeof Object>).pipe(toArray())) as Promise<BaseEvent[]>
}

describe("MrrawbotAgentRunner", () => {
  let tempDir = ""
  let closeDb: (() => void) | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mrr-runner-"))
    vi.resetModules()
    vi.stubEnv("MRRAWBOT_DB", path.join(tempDir, "mrrawbot.db"))
  })

  afterEach(async () => {
    closeDb?.()
    closeDb = undefined
    vi.unstubAllEnvs()
    await rm(tempDir, { recursive: true, force: true })
  })

  async function setup() {
    const dbModule = await import("../../db/db.ts")
    closeDb = dbModule.closeDb
    const { createProject } = await import("../../db/repos/projects.ts")
    const { createThread } = await import("../../db/repos/threads.ts")
    const { saveMessage } = await import("../../db/repos/messages.ts")
    const { MrrawbotAgentRunner } = await import("./runner.ts")
    const project = createProject({ name: "Repo", repoPath: tempDir, repoName: "repo" })
    const thread = createThread({ projectId: project.id })
    return { thread, saveMessage, runner: new MrrawbotAgentRunner() }
  }

  it("connect replays persisted messages as a bookended synthetic run", async () => {
    const { thread, saveMessage, runner } = await setup()
    saveMessage({ id: "m1", threadId: thread.id, role: "user", content: "hello" })
    saveMessage({ id: "m2", threadId: thread.id, role: "assistant", content: "hi there" })

    const events = await collect(runner.connect({ threadId: thread.id }))

    expect(events.map((e) => e.type)).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED])
    const started = events[0] as BaseEvent & { input: { messages: { id: string; role: string }[] } }
    expect(started.input.messages.map((m) => m.id)).toEqual(["m1", "m2"])
  })

  it("connect completes empty for a thread with no history", async () => {
    const { thread, runner } = await setup()
    expect(await collect(runner.connect({ threadId: thread.id }))).toEqual([])
  })

  it("run streams agent events, injects sanitized input, and finalizes the stream", async () => {
    const { thread, saveMessage, runner } = await setup()
    saveMessage({ id: "old", threadId: thread.id, role: "user", content: "earlier" })

    const input = {
      threadId: thread.id,
      runId: "run-1",
      messages: [
        { id: "old", role: "user", content: "earlier" },
        { id: "new", role: "user", content: "follow up" },
      ],
    }
    const agent = fakeAgent([
      { type: EventType.RUN_STARTED, threadId: thread.id, runId: "run-1" } as unknown as BaseEvent,
      { type: EventType.TEXT_MESSAGE_START, messageId: "a1", role: "assistant" } as unknown as BaseEvent,
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "a1", delta: "done" } as unknown as BaseEvent,
      { type: EventType.TEXT_MESSAGE_END, messageId: "a1" } as unknown as BaseEvent,
      { type: EventType.RUN_FINISHED, threadId: thread.id, runId: "run-1" } as unknown as BaseEvent,
    ])

    const events = await collect(
      runner.run({ threadId: thread.id, agent, input } as unknown as AgentRunnerRunRequest),
    )

    const started = events[0] as BaseEvent & { input: { messages: { id: string }[] } }
    expect(started.input.messages.map((m) => m.id)).toEqual(["new"])
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED)
    expect(await runner.isRunning({ threadId: thread.id })).toBe(false)
  })

  it("connect attaches to a live run, skipping messages the history already covers", async () => {
    const { thread, saveMessage, runner } = await setup()
    saveMessage({ id: "u1", threadId: thread.id, role: "user", content: "go" })

    let releaseRun!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseRun = resolve
    })
    const agent = {
      async runAgent(_input: unknown, { onEvent }: { onEvent: (p: { event: BaseEvent }) => void }) {
        onEvent({ event: { type: EventType.RUN_STARTED, threadId: thread.id, runId: "run-live" } as unknown as BaseEvent })
        onEvent({ event: { type: EventType.TEXT_MESSAGE_START, messageId: "u1", role: "user" } as unknown as BaseEvent })
        onEvent({ event: { type: EventType.TEXT_MESSAGE_END, messageId: "u1" } as unknown as BaseEvent })
        onEvent({ event: { type: EventType.STATE_SNAPSHOT, snapshot: { runId: "run-live" } } as unknown as BaseEvent })
        await gate
        onEvent({ event: { type: EventType.RUN_FINISHED, threadId: thread.id, runId: "run-live" } as unknown as BaseEvent })
      },
      abortRun: vi.fn(),
    } as unknown as RunnerAgent

    const runEvents = collect(
      runner.run({
        threadId: thread.id,
        agent,
        input: { threadId: thread.id, runId: "run-live", messages: [] },
      } as unknown as AgentRunnerRunRequest),
    )
    await Promise.resolve()
    expect(await runner.isRunning({ threadId: thread.id })).toBe(true)

    const connected = collect(runner.connect({ threadId: thread.id }))
    releaseRun()
    const events = await connected
    await runEvents

    // History bookend for u1, then the live run minus u1's message events.
    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.RUN_FINISHED,
    ])
  })

  it("a new run takes over a stale live run instead of failing", async () => {
    const { thread, runner } = await setup()

    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstAgent = fakeAgent(
      [{ type: EventType.RUN_STARTED, threadId: thread.id, runId: "run-a" } as unknown as BaseEvent],
      { settle: () => firstGate },
    )
    const firstEvents = collect(
      runner.run({
        threadId: thread.id,
        agent: firstAgent,
        input: { threadId: thread.id, runId: "run-a", messages: [] },
      } as unknown as AgentRunnerRunRequest),
    )
    await Promise.resolve()

    const secondAgent = fakeAgent([
      { type: EventType.RUN_STARTED, threadId: thread.id, runId: "run-b" } as unknown as BaseEvent,
      { type: EventType.RUN_FINISHED, threadId: thread.id, runId: "run-b" } as unknown as BaseEvent,
    ])
    const secondEvents = collect(
      runner.run({
        threadId: thread.id,
        agent: secondAgent,
        input: { threadId: thread.id, runId: "run-b", messages: [] },
      } as unknown as AgentRunnerRunRequest),
    )
    await Promise.resolve()
    expect(firstAgent.abortRun).toHaveBeenCalled()

    releaseFirst()
    const first = await firstEvents
    // The stopped run gets closed out by the runner rather than left dangling.
    expect(first.at(-1)?.type).toBe(EventType.RUN_FINISHED)

    const second = await secondEvents
    expect(second.map((e) => e.type)).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED])
    expect(await runner.isRunning({ threadId: thread.id })).toBe(false)
  })
})
