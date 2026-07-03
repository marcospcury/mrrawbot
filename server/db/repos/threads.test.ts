import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("thread repository naming", () => {
  let tempDir = ""
  let closeDb: (() => void) | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mrr-threads-"))
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
    const dbModule = await import("../db.ts")
    closeDb = dbModule.closeDb
    const { createProject } = await import("./projects.ts")
    const threads = await import("./threads.ts")
    const project = createProject({ name: "Repo", repoPath: tempDir, repoName: "repo" })
    return { project, threads }
  }

  it("auto-names a default thread at most once", async () => {
    const { project, threads } = await setup()
    const thread = threads.createThread({ projectId: project.id })

    expect(thread.autoTitleGeneratedAt).toBeNull()
    expect(thread.titleManuallyEdited).toBe(false)

    expect(threads.threadCanAutoName(thread.id)).toBe(true)

    const named = threads.autoNameThread(thread.id, "Fix Login Redirect")
    expect(named?.title).toBe("Fix Login Redirect")
    expect(named?.autoTitleGeneratedAt).toBeTruthy()
    expect(threads.threadCanAutoName(thread.id)).toBe(false)

    const second = threads.autoNameThread(thread.id, "Different Title")
    expect(second).toBeUndefined()
    expect(threads.getThread(thread.id)?.title).toBe("Fix Login Redirect")
  })

  it("does not auto-name a manually named thread", async () => {
    const { project, threads } = await setup()
    const thread = threads.createThread({ projectId: project.id })

    threads.renameThread(thread.id, "Manual Title")

    expect(threads.getThread(thread.id)?.titleManuallyEdited).toBe(true)
    expect(threads.getThread(thread.id)?.autoTitleGeneratedAt).toBeNull()

    expect(threads.threadCanAutoName(thread.id)).toBe(false)
    expect(threads.autoNameThread(thread.id, "Generated Title")).toBeUndefined()
    expect(threads.getThread(thread.id)?.title).toBe("Manual Title")
  })

  it("keeps manual rename available after an auto-name", async () => {
    const { project, threads } = await setup()
    const thread = threads.createThread({ projectId: project.id })

    threads.autoNameThread(thread.id, "Generated Title")
    const renamed = threads.renameThread(thread.id, "Manual Follow-Up")

    expect(renamed?.titleManuallyEdited).toBe(true)
    expect(renamed?.title).toBe("Manual Follow-Up")
    expect(threads.getThread(thread.id)?.title).toBe("Manual Follow-Up")
  })

  it("treats an explicit create title as manually named", async () => {
    const { project, threads } = await setup()
    const thread = threads.createThread({ projectId: project.id, title: "Explicit Title" })

    expect(threads.threadCanAutoName(thread.id)).toBe(false)
    expect(threads.autoNameThread(thread.id, "Generated Title")).toBeUndefined()
    expect(threads.getThread(thread.id)?.title).toBe("Explicit Title")
  })
})
