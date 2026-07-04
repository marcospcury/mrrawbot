import type { ArtifactInfo, ArtifactKind } from "@shared/types.ts"
import { db, newId, now } from "../db.ts"

interface ArtifactRow {
  id: string
  project_id: string
  thread_id: string | null
  run_id: string | null
  kind: ArtifactKind
  slug: string
  title: string
  created_at: string
  updated_at: string
}

function hydrate(r: ArtifactRow): ArtifactInfo {
  return {
    id: r.id,
    projectId: r.project_id,
    threadId: r.thread_id,
    runId: r.run_id,
    kind: r.kind,
    slug: r.slug,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const stmts = {
  upsert: db.prepare<Record<string, unknown>, ArtifactRow>(
    `INSERT INTO artifacts (id, project_id, thread_id, run_id, kind, slug, title, created_at, updated_at)
     VALUES (:id, :project_id, :thread_id, :run_id, :kind, :slug, :title, :now, :now)
     ON CONFLICT(project_id, kind, slug) DO UPDATE SET
       thread_id  = COALESCE(excluded.thread_id, thread_id),
       run_id     = COALESCE(excluded.run_id, run_id),
       title      = excluded.title,
       updated_at = excluded.updated_at
     RETURNING *`,
  ),
  listByProject: db.prepare<{ project_id: string }, ArtifactRow>(
    `SELECT * FROM artifacts WHERE project_id = :project_id ORDER BY updated_at DESC`,
  ),
  listByProjectKind: db.prepare<{ project_id: string; kind: string }, ArtifactRow>(
    `SELECT * FROM artifacts WHERE project_id = :project_id AND kind = :kind ORDER BY updated_at DESC`,
  ),
  get: db.prepare<{ project_id: string; kind: string; slug: string }, ArtifactRow>(
    `SELECT * FROM artifacts WHERE project_id = :project_id AND kind = :kind AND slug = :slug`,
  ),
  byId: db.prepare<{ id: string }, ArtifactRow>(`SELECT * FROM artifacts WHERE id = :id`),
  delete: db.prepare<{ project_id: string; kind: string; slug: string }>(
    `DELETE FROM artifacts WHERE project_id = :project_id AND kind = :kind AND slug = :slug`,
  ),
  listAttached: db.prepare<{ thread_id: string }, ArtifactRow>(
    `SELECT a.* FROM artifacts a
       JOIN thread_artifacts ta ON ta.artifact_id = a.id
      WHERE ta.thread_id = :thread_id
      ORDER BY ta.created_at, ta.rowid`,
  ),
  clearAttached: db.prepare<{ thread_id: string }>(
    `DELETE FROM thread_artifacts WHERE thread_id = :thread_id`,
  ),
  attach: db.prepare<{ thread_id: string; artifact_id: string; created_at: string }>(
    `INSERT OR IGNORE INTO thread_artifacts (thread_id, artifact_id, created_at)
     VALUES (:thread_id, :artifact_id, :created_at)`,
  ),
}

export function upsertArtifact(input: {
  projectId: string
  threadId?: string | null
  runId?: string | null
  kind: ArtifactKind
  slug: string
  title: string
}): ArtifactInfo {
  return hydrate(
    stmts.upsert.get({
      id: newId("art"),
      project_id: input.projectId,
      thread_id: input.threadId ?? null,
      run_id: input.runId ?? null,
      kind: input.kind,
      slug: input.slug,
      title: input.title,
      now: now(),
    })!,
  )
}

export function listArtifacts(projectId: string, kind?: ArtifactKind): ArtifactInfo[] {
  const rows = kind
    ? stmts.listByProjectKind.all({ project_id: projectId, kind })
    : stmts.listByProject.all({ project_id: projectId })
  return rows.map(hydrate)
}

export function getArtifact(projectId: string, kind: ArtifactKind, slug: string): ArtifactInfo | null {
  const row = stmts.get.get({ project_id: projectId, kind, slug })
  return row ? hydrate(row) : null
}

export function getArtifactById(id: string): ArtifactInfo | null {
  const row = stmts.byId.get({ id })
  return row ? hydrate(row) : null
}

export function deleteArtifact(projectId: string, kind: ArtifactKind, slug: string): void {
  stmts.delete.run({ project_id: projectId, kind, slug })
}

/** Artifacts attached to a build thread, in attach order. */
export function listThreadArtifacts(threadId: string): ArtifactInfo[] {
  return stmts.listAttached.all({ thread_id: threadId }).map(hydrate)
}

/** Replace the full attachment set for a thread. */
export const setThreadArtifacts = db.transaction((threadId: string, artifactIds: string[]): void => {
  stmts.clearAttached.run({ thread_id: threadId })
  const ts = now()
  for (const artifactId of artifactIds) {
    stmts.attach.run({ thread_id: threadId, artifact_id: artifactId, created_at: ts })
  }
})
