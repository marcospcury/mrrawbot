import { DEFAULT_ROLE_ID, type SessionConfig, type Thread } from "@shared/types.ts"
import { db, newId, now } from "../db.ts"

interface ThreadRow {
  id: string
  project_id: string
  title: string
  archived: 0 | 1
  flow_id: string | null
  session: string | null
  auto_title_generated_at: string | null
  title_manually_edited: 0 | 1
  created_at: string
  updated_at: string
}

function parseSession(raw: string | null): SessionConfig | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as SessionConfig
    return { ...s, fast: s.fast ?? false, role: s.role || DEFAULT_ROLE_ID }
  } catch {
    return null
  }
}

function hydrate(r: ThreadRow): Thread {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    archived: r.archived === 1,
    flowId: r.flow_id,
    session: parseSession(r.session),
    autoTitleGeneratedAt: r.auto_title_generated_at,
    titleManuallyEdited: r.title_manually_edited === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const stmts = {
  listByProject: db.prepare<{ project_id: string; include_archived: number }, ThreadRow>(
    `SELECT * FROM threads
       WHERE project_id = :project_id AND (:include_archived = 1 OR archived = 0)
       ORDER BY updated_at DESC`,
  ),
  byId: db.prepare<{ id: string }, ThreadRow>(`SELECT * FROM threads WHERE id = :id`),
  autoNameCandidate: db.prepare<{ id: string }, { id: string }>(
    `SELECT id
       FROM threads
      WHERE id = :id
        AND auto_title_generated_at IS NULL
        AND COALESCE(title_manually_edited, 0) = 0`,
  ),
  insert: db.prepare<Record<string, unknown>, ThreadRow>(
    `INSERT INTO threads (
       id, project_id, title, archived, flow_id, session, auto_title_generated_at, title_manually_edited, created_at, updated_at
     )
     VALUES (
       :id, :project_id, :title, 0, :flow_id, :session, NULL, :title_manually_edited, :created_at, :updated_at
     )
     RETURNING *`,
  ),
  rename: db.prepare<{ id: string; title: string; updated_at: string }, ThreadRow>(
    `UPDATE threads
        SET title = :title, title_manually_edited = 1, updated_at = :updated_at
      WHERE id = :id
      RETURNING *`,
  ),
  autoName: db.prepare<{ id: string; title: string; updated_at: string }, ThreadRow>(
    `UPDATE threads
        SET title = :title, auto_title_generated_at = :updated_at, updated_at = :updated_at
      WHERE id = :id
        AND auto_title_generated_at IS NULL
        AND COALESCE(title_manually_edited, 0) = 0
      RETURNING *`,
  ),
  setArchived: db.prepare<{ id: string; archived: number; updated_at: string }, ThreadRow>(
    `UPDATE threads SET archived = :archived, updated_at = :updated_at WHERE id = :id RETURNING *`,
  ),
  setFlow: db.prepare<{ id: string; flow_id: string | null; updated_at: string }, ThreadRow>(
    `UPDATE threads SET flow_id = :flow_id, updated_at = :updated_at WHERE id = :id RETURNING *`,
  ),
  setSession: db.prepare<{ id: string; session: string | null; updated_at: string }, ThreadRow>(
    `UPDATE threads SET session = :session, updated_at = :updated_at WHERE id = :id RETURNING *`,
  ),
  touch: db.prepare<{ id: string; updated_at: string }>(
    `UPDATE threads SET updated_at = :updated_at WHERE id = :id`,
  ),
  remove: db.prepare<{ id: string }>(`DELETE FROM threads WHERE id = :id`),
}

export function listThreads(projectId: string, includeArchived = false): Thread[] {
  return stmts.listByProject.all({ project_id: projectId, include_archived: includeArchived ? 1 : 0 }).map(hydrate)
}

export function getThread(id: string): Thread | undefined {
  const r = stmts.byId.get({ id })
  return r && hydrate(r)
}

export function createThread(input: {
  projectId: string
  title?: string
  flowId?: string | null
  session?: SessionConfig | null
  id?: string
}): Thread {
  const ts = now()
  return hydrate(
    stmts.insert.get({
      id: input.id ?? newId("thr"),
      project_id: input.projectId,
      title: input.title?.trim() || "New thread",
      flow_id: input.flowId ?? null,
      session: input.session ? JSON.stringify(input.session) : null,
      title_manually_edited: input.title?.trim() ? 1 : 0,
      created_at: ts,
      updated_at: ts,
    })!,
  )
}

export function renameThread(id: string, title: string): Thread | undefined {
  const r = stmts.rename.get({ id, title: title.trim() || "Untitled", updated_at: now() })
  return r && hydrate(r)
}

export function threadCanAutoName(id: string): boolean {
  return !!stmts.autoNameCandidate.get({ id })
}

export function autoNameThread(id: string, title: string): Thread | undefined {
  const cleanTitle = title.trim()
  if (!cleanTitle) return undefined
  const r = stmts.autoName.get({ id, title: cleanTitle, updated_at: now() })
  return r && hydrate(r)
}

export function setThreadArchived(id: string, archived: boolean): Thread | undefined {
  const r = stmts.setArchived.get({ id, archived: archived ? 1 : 0, updated_at: now() })
  return r && hydrate(r)
}

export function setThreadFlow(id: string, flowId: string | null): Thread | undefined {
  const r = stmts.setFlow.get({ id, flow_id: flowId, updated_at: now() })
  return r && hydrate(r)
}

export function setThreadSession(id: string, session: SessionConfig | null): Thread | undefined {
  const r = stmts.setSession.get({ id, session: session ? JSON.stringify(session) : null, updated_at: now() })
  return r && hydrate(r)
}

export function touchThread(id: string): void {
  stmts.touch.run({ id, updated_at: now() })
}

export function deleteThread(id: string): boolean {
  return stmts.remove.run({ id }).changes > 0
}
