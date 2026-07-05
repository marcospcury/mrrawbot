import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("thread folders", () => {
  let tempDir = ""
  let closeDb: (() => void) | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mrr-folders-"))
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
    const folders = await import("./folders.ts")
    const threads = await import("./threads.ts")
    const project = createProject({ name: "Repo", repoPath: tempDir, repoName: "repo" })
    return { project, folders, threads }
  }

  it("creates, renames, and lists folders per project", async () => {
    const { project, folders } = await setup()
    const folder = folders.createFolder({ projectId: project.id, name: "Auth work" })

    expect(folders.listFolders(project.id)).toEqual([expect.objectContaining({ name: "Auth work" })])
    expect(folders.renameFolder(folder.id, "Auth revamp")?.name).toBe("Auth revamp")
  })

  it("moves threads back to the top level when their folder is deleted", async () => {
    const { project, folders, threads } = await setup()
    const folder = folders.createFolder({ projectId: project.id, name: "Group" })
    const thread = threads.createThread({ projectId: project.id })

    expect(threads.setThreadFolder(thread.id, folder.id)?.folderId).toBe(folder.id)
    expect(folders.deleteFolder(folder.id)).toBe(true)
    expect(threads.getThread(thread.id)?.folderId).toBeNull()
  })

  it("records the branch a thread works on", async () => {
    const { project, threads } = await setup()
    const thread = threads.createThread({ projectId: project.id })

    expect(thread.branchName).toBeNull()
    expect(threads.setThreadBranch(thread.id, "feat/upload")?.branchName).toBe("feat/upload")
    expect(threads.setThreadBranch(thread.id, "  ")?.branchName).toBeNull()
  })
})
