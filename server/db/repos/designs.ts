import type { DesignInfo } from "@shared/types.ts"
import { db, newId, now } from "../db.ts"

interface DesignRow {
  id: string
  project_id: string
  thread_id: string | null
  run_id: string | null
  slug: string
  title: string
  created_at: string
  updated_at: string
}

function hydrate(r: DesignRow): DesignInfo {
  return {
    id: r.id,
    projectId: r.project_id,
    threadId: r.thread_id,
    runId: r.run_id,
    slug: r.slug,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const stmts = {
  upsert: db.prepare<Record<string, unknown>, DesignRow>(
    `INSERT INTO designs (id, project_id, thread_id, run_id, slug, title, created_at, updated_at)
     VALUES (:id, :project_id, :thread_id, :run_id, :slug, :title, :now, :now)
     ON CONFLICT(project_id, slug) DO UPDATE SET
       thread_id  = COALESCE(excluded.thread_id, thread_id),
       run_id     = COALESCE(excluded.run_id, run_id),
       title      = excluded.title,
       updated_at = excluded.updated_at
     RETURNING *`,
  ),
  listByProject: db.prepare<{ project_id: string }, DesignRow>(
    `SELECT * FROM designs WHERE project_id = :project_id ORDER BY updated_at DESC`,
  ),
  get: db.prepare<{ project_id: string; slug: string }, DesignRow>(
    `SELECT * FROM designs WHERE project_id = :project_id AND slug = :slug`,
  ),
  delete: db.prepare<{ project_id: string; slug: string }>(
    `DELETE FROM designs WHERE project_id = :project_id AND slug = :slug`,
  ),
}

export function upsertDesign(input: {
  projectId: string
  threadId?: string | null
  runId?: string | null
  slug: string
  title: string
}): DesignInfo {
  return hydrate(
    stmts.upsert.get({
      id: newId("dsn"),
      project_id: input.projectId,
      thread_id: input.threadId ?? null,
      run_id: input.runId ?? null,
      slug: input.slug,
      title: input.title,
      now: now(),
    })!,
  )
}

export function listDesigns(projectId: string): DesignInfo[] {
  return stmts.listByProject.all({ project_id: projectId }).map(hydrate)
}

export function getDesign(projectId: string, slug: string): DesignInfo | null {
  const row = stmts.get.get({ project_id: projectId, slug })
  return row ? hydrate(row) : null
}

export function deleteDesign(projectId: string, slug: string): void {
  stmts.delete.run({ project_id: projectId, slug })
}
