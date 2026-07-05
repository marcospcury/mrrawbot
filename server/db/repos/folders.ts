import type { ThreadFolder } from "@shared/types.ts"
import { db, newId, now } from "../db.ts"

interface FolderRow {
  id: string
  project_id: string
  name: string
  created_at: string
  updated_at: string
}

function hydrate(r: FolderRow): ThreadFolder {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const stmts = {
  listByProject: db.prepare<{ project_id: string }, FolderRow>(
    `SELECT * FROM thread_folders WHERE project_id = :project_id ORDER BY name COLLATE NOCASE`,
  ),
  byId: db.prepare<{ id: string }, FolderRow>(`SELECT * FROM thread_folders WHERE id = :id`),
  insert: db.prepare<Record<string, unknown>, FolderRow>(
    `INSERT INTO thread_folders (id, project_id, name, created_at, updated_at)
     VALUES (:id, :project_id, :name, :created_at, :updated_at)
     RETURNING *`,
  ),
  rename: db.prepare<{ id: string; name: string; updated_at: string }, FolderRow>(
    `UPDATE thread_folders SET name = :name, updated_at = :updated_at WHERE id = :id RETURNING *`,
  ),
  remove: db.prepare<{ id: string }>(`DELETE FROM thread_folders WHERE id = :id`),
}

export function listFolders(projectId: string): ThreadFolder[] {
  return stmts.listByProject.all({ project_id: projectId }).map(hydrate)
}

export function getFolder(id: string): ThreadFolder | undefined {
  const r = stmts.byId.get({ id })
  return r && hydrate(r)
}

export function createFolder(input: { projectId: string; name: string }): ThreadFolder {
  const ts = now()
  return hydrate(
    stmts.insert.get({
      id: newId("fld"),
      project_id: input.projectId,
      name: input.name.trim(),
      created_at: ts,
      updated_at: ts,
    })!,
  )
}

export function renameFolder(id: string, name: string): ThreadFolder | undefined {
  const r = stmts.rename.get({ id, name: name.trim(), updated_at: now() })
  return r && hydrate(r)
}

/** Threads inside the folder are kept and moved to the top level (FK: ON DELETE SET NULL). */
export function deleteFolder(id: string): boolean {
  return stmts.remove.run({ id }).changes > 0
}
