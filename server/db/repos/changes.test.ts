import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("thread changes repository", () => {
  let tempDir = ""
  let closeDb: (() => void) | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mrr-changes-"))
    vi.resetModules()
    vi.stubEnv("MRRAWBOT_DB", path.join(tempDir, "mrrawbot.db"))
  })

  afterEach(async () => {
    closeDb?.()
    closeDb = undefined
    vi.unstubAllEnvs()
    await rm(tempDir, { recursive: true, force: true })
  })

  it("replaces an existing change for the same thread, run, and file", async () => {
    const dbModule = await import("../db.ts")
    closeDb = dbModule.closeDb
    const { createProject } = await import("./projects.ts")
    const { createThread } = await import("./threads.ts")
    const { listThreadChanges, upsertThreadChange } = await import("./changes.ts")

    const project = createProject({ name: "Repo", repoPath: tempDir, repoName: "repo" })
    const thread = createThread({ projectId: project.id, title: "Task" })

    const first = upsertThreadChange({
      threadId: thread.id,
      runId: "run_1",
      filePath: "src/a.ts",
      changeStatus: "modified",
      beforeContent: "old",
      afterContent: "new",
    })
    const second = upsertThreadChange({
      threadId: thread.id,
      runId: "run_1",
      filePath: "src/a.ts",
      changeStatus: "deleted",
      beforeContent: "new",
      afterContent: null,
      truncated: true,
    })

    expect(second.id).not.toBe(first.id)
    expect(listThreadChanges(thread.id)).toEqual([
      expect.objectContaining({
        id: second.id,
        threadId: thread.id,
        runId: "run_1",
        filePath: "src/a.ts",
        changeStatus: "deleted",
        beforeContent: "new",
        afterContent: null,
        truncated: true,
      }),
    ])
  })

  it("lists only the selected thread and cascades away with thread deletion", async () => {
    const dbModule = await import("../db.ts")
    closeDb = dbModule.closeDb
    const { db } = dbModule
    const { createProject } = await import("./projects.ts")
    const { createThread, deleteThread } = await import("./threads.ts")
    const { listThreadChanges, upsertThreadChange } = await import("./changes.ts")

    const project = createProject({ name: "Repo", repoPath: tempDir, repoName: "repo" })
    const thread = createThread({ projectId: project.id, title: "Task" })
    const otherThread = createThread({ projectId: project.id, title: "Other task" })

    upsertThreadChange({
      threadId: otherThread.id,
      runId: "run_other",
      filePath: "other.ts",
      changeStatus: "added",
      afterContent: "other",
      beforeMissing: true,
    })
    upsertThreadChange({
      threadId: thread.id,
      runId: "run_1",
      filePath: "src/old.ts",
      changeStatus: "deleted",
      beforeContent: "old",
      binary: true,
    })
    const latest = upsertThreadChange({
      threadId: thread.id,
      runId: "run_2",
      filePath: "src/new.ts",
      changeStatus: "added",
      afterContent: "new",
      beforeMissing: true,
    })

    const listed = listThreadChanges(thread.id)
    expect(listed.map((change) => change.filePath)).toEqual(["src/new.ts", "src/old.ts"])
    expect(listed[0]).toEqual(expect.objectContaining({ id: latest.id, beforeMissing: true }))
    expect(listed.some((change) => change.filePath === "other.ts")).toBe(false)

    expect(deleteThread(thread.id)).toBe(true)
    expect(listThreadChanges(thread.id)).toEqual([])
    expect((db.prepare(`SELECT COUNT(*) AS count FROM thread_changes`).get() as { count: number }).count).toBe(1)
  })
})
