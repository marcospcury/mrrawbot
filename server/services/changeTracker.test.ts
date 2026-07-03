import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const pexec = promisify(execFile)

describe("change tracker", () => {
  let tempDir = ""
  let closeDb: (() => void) | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mrr-change-tracker-"))
    vi.resetModules()
    vi.stubEnv("MRRAWBOT_DB", path.join(tempDir, "mrrawbot.db"))
  })

  afterEach(async () => {
    closeDb?.()
    closeDb = undefined
    vi.unstubAllEnvs()
    await rm(tempDir, { recursive: true, force: true })
  })

  it("captures modified, added, and deleted files in a git repo", async () => {
    const repoPath = path.join(tempDir, "repo")
    await mkdir(repoPath)
    await pexec("git", ["init"], { cwd: repoPath })
    await pexec("git", ["config", "user.email", "test@example.com"], { cwd: repoPath })
    await pexec("git", ["config", "user.name", "Test User"], { cwd: repoPath })
    await writeFile(path.join(repoPath, "existing.txt"), "before\n")
    await writeFile(path.join(repoPath, "remove.txt"), "delete me\n")
    await pexec("git", ["add", "."], { cwd: repoPath })
    await pexec("git", ["commit", "-m", "initial"], { cwd: repoPath })

    const dbModule = await import("../db/db.ts")
    closeDb = dbModule.closeDb
    const { createProject } = await import("../db/repos/projects.ts")
    const { createThread } = await import("../db/repos/threads.ts")
    const { listThreadChanges } = await import("../db/repos/changes.ts")
    const { createChangeTracker } = await import("./changeTracker.ts")

    const project = createProject({ name: "Repo", repoPath, repoName: "repo" })
    const thread = createThread({ projectId: project.id, title: "Task" })
    const tracker = await createChangeTracker({ threadId: thread.id, runId: "run_git", repoPath })

    await writeFile(path.join(repoPath, "existing.txt"), "after\n")
    await writeFile(path.join(repoPath, "added.txt"), "new file\n")
    await unlink(path.join(repoPath, "remove.txt"))

    await tracker.finish()

    const byPath = new Map(listThreadChanges(thread.id).map((change) => [change.filePath, change]))
    expect([...byPath.keys()].sort()).toEqual(["added.txt", "existing.txt", "remove.txt"])
    expect(byPath.get("existing.txt")).toEqual(
      expect.objectContaining({
        runId: "run_git",
        changeStatus: "modified",
        beforeContent: "before\n",
        afterContent: "after\n",
        beforeMissing: false,
      }),
    )
    expect(byPath.get("added.txt")).toEqual(
      expect.objectContaining({
        changeStatus: "added",
        beforeContent: null,
        afterContent: "new file\n",
        beforeMissing: true,
      }),
    )
    expect(byPath.get("remove.txt")).toEqual(
      expect.objectContaining({
        changeStatus: "deleted",
        beforeContent: "delete me\n",
        afterContent: null,
        beforeMissing: false,
      }),
    )
  })

  it("captures non-git writes observed through tool callbacks", async () => {
    const repoPath = path.join(tempDir, "repo")
    await mkdir(repoPath)
    await writeFile(path.join(repoPath, "file.txt"), "before\n")

    const dbModule = await import("../db/db.ts")
    closeDb = dbModule.closeDb
    const { createProject } = await import("../db/repos/projects.ts")
    const { createThread } = await import("../db/repos/threads.ts")
    const { listThreadChanges } = await import("../db/repos/changes.ts")
    const { createChangeTracker } = await import("./changeTracker.ts")

    const project = createProject({ name: "Repo", repoPath, repoName: "repo" })
    const thread = createThread({ projectId: project.id, title: "Task" })
    const tracker = await createChangeTracker({ threadId: thread.id, runId: "run_non_git", repoPath })

    tracker.onToolObserved("write_file", { path: "file.txt" })
    await writeFile(path.join(repoPath, "file.txt"), "after\n")
    await tracker.finish()

    expect(listThreadChanges(thread.id)).toEqual([
      expect.objectContaining({
        runId: "run_non_git",
        filePath: "file.txt",
        changeStatus: "modified",
        beforeContent: "before\n",
        afterContent: "after\n",
        beforeMissing: false,
      }),
    ])
  })
})
