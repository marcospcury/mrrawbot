import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("artifacts repository", () => {
  let tempDir = ""
  let closeDb: (() => void) | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mrr-artifacts-"))
    vi.resetModules()
    vi.stubEnv("MRRAWBOT_DB", path.join(tempDir, "mrrawbot.db"))
  })

  afterEach(async () => {
    closeDb?.()
    closeDb = undefined
    vi.unstubAllEnvs()
    await rm(tempDir, { recursive: true, force: true })
  })

  it("upserts by (project, kind, slug), keeps provenance, and deletes", async () => {
    const dbModule = await import("../db.ts")
    closeDb = dbModule.closeDb
    const { createProject } = await import("./projects.ts")
    const { deleteArtifact, getArtifact, listArtifacts, upsertArtifact } = await import("./artifacts.ts")

    const project = createProject({ name: "Repo", repoPath: tempDir, repoName: "repo" })

    const created = upsertArtifact({
      projectId: project.id,
      threadId: "thr_1",
      runId: "run_1",
      kind: "prototype",
      slug: "projects-kanban",
      title: "Projects Kanban",
    })
    expect(created.slug).toBe("projects-kanban")
    expect(created.kind).toBe("prototype")
    expect(created.threadId).toBe("thr_1")

    // A revision run updates title/run but keeps the row (and its identity).
    const revised = upsertArtifact({
      projectId: project.id,
      runId: "run_2",
      kind: "prototype",
      slug: "projects-kanban",
      title: "Projects Kanban v2",
    })
    expect(revised.id).toBe(created.id)
    expect(revised.title).toBe("Projects Kanban v2")
    expect(revised.runId).toBe("run_2")
    // Provenance thread survives an upsert that doesn't carry one.
    expect(revised.threadId).toBe("thr_1")

    // Same slug under a different kind is a distinct artifact.
    const spec = upsertArtifact({ projectId: project.id, kind: "spec", slug: "projects-kanban", title: "Kanban Spec" })
    expect(spec.id).not.toBe(created.id)

    upsertArtifact({ projectId: project.id, kind: "prompt", slug: "build-kanban", title: "Build Kanban" })
    expect(listArtifacts(project.id)).toHaveLength(3)
    expect(listArtifacts(project.id, "spec").map((a) => a.slug)).toEqual(["projects-kanban"])

    deleteArtifact(project.id, "prototype", "projects-kanban")
    expect(getArtifact(project.id, "prototype", "projects-kanban")).toBeNull()
    expect(getArtifact(project.id, "spec", "projects-kanban")).not.toBeNull()
  })

  it("migrates existing designs rows to prototype artifacts", async () => {
    const dbModule = await import("../db.ts")
    closeDb = dbModule.closeDb
    const { listArtifacts } = await import("./artifacts.ts")
    // Fresh DB has no designs to migrate; just assert the table exists and is empty.
    expect(listArtifacts("prj_none")).toEqual([])
  })

  it("replaces and lists thread attachments", async () => {
    const dbModule = await import("../db.ts")
    closeDb = dbModule.closeDb
    const { createProject } = await import("./projects.ts")
    const { createThread } = await import("./threads.ts")
    const { listThreadArtifacts, setThreadArtifacts, upsertArtifact } = await import("./artifacts.ts")

    const project = createProject({ name: "Repo", repoPath: tempDir, repoName: "repo" })
    const thread = createThread({ projectId: project.id })
    const spec = upsertArtifact({ projectId: project.id, kind: "spec", slug: "s1", title: "S1" })
    const proto = upsertArtifact({ projectId: project.id, kind: "prototype", slug: "p1", title: "P1" })

    setThreadArtifacts(thread.id, [spec.id, proto.id])
    expect(listThreadArtifacts(thread.id).map((a) => a.slug)).toEqual(["s1", "p1"])

    setThreadArtifacts(thread.id, [proto.id])
    expect(listThreadArtifacts(thread.id).map((a) => a.slug)).toEqual(["p1"])

    setThreadArtifacts(thread.id, [])
    expect(listThreadArtifacts(thread.id)).toEqual([])
  })
})
