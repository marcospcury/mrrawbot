import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("designs repository", () => {
  let tempDir = ""
  let closeDb: (() => void) | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mrr-designs-"))
    vi.resetModules()
    vi.stubEnv("MRRAWBOT_DB", path.join(tempDir, "mrrawbot.db"))
  })

  afterEach(async () => {
    closeDb?.()
    closeDb = undefined
    vi.unstubAllEnvs()
    await rm(tempDir, { recursive: true, force: true })
  })

  it("upserts by (project, slug), keeps provenance, and deletes", async () => {
    const dbModule = await import("../db.ts")
    closeDb = dbModule.closeDb
    const { createProject } = await import("./projects.ts")
    const { deleteDesign, getDesign, listDesigns, upsertDesign } = await import("./designs.ts")

    const project = createProject({ name: "Repo", repoPath: tempDir, repoName: "repo" })

    const created = upsertDesign({
      projectId: project.id,
      threadId: "thr_1",
      runId: "run_1",
      slug: "projects-kanban",
      title: "Projects Kanban",
    })
    expect(created.slug).toBe("projects-kanban")
    expect(created.threadId).toBe("thr_1")

    // A revision run updates title/run but keeps the row (and its identity).
    const revised = upsertDesign({
      projectId: project.id,
      runId: "run_2",
      slug: "projects-kanban",
      title: "Projects Kanban v2",
    })
    expect(revised.id).toBe(created.id)
    expect(revised.title).toBe("Projects Kanban v2")
    expect(revised.runId).toBe("run_2")
    // Provenance thread survives an upsert that doesn't carry one.
    expect(revised.threadId).toBe("thr_1")

    upsertDesign({ projectId: project.id, slug: "other", title: "Other" })
    expect(listDesigns(project.id).map((d) => d.slug).sort()).toEqual(["other", "projects-kanban"])

    deleteDesign(project.id, "projects-kanban")
    expect(getDesign(project.id, "projects-kanban")).toBeNull()
    expect(listDesigns(project.id)).toHaveLength(1)
  })
})
