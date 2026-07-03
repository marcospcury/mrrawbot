import type { Project } from "@shared/types.ts"
import { db, newId, now } from "../db.ts"

interface ProjectRow {
  id: string
  name: string
  repo_path: string
  repo_name: string
  default_flow_id: string | null
  created_at: string
  updated_at: string
}

function hydrate(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    repoPath: r.repo_path,
    repoName: r.repo_name,
    defaultFlowId: r.default_flow_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const stmts = {
  list: db.prepare<[], ProjectRow>(`SELECT * FROM projects ORDER BY updated_at DESC`),
  byId: db.prepare<{ id: string }, ProjectRow>(`SELECT * FROM projects WHERE id = :id`),
  byPath: db.prepare<{ repo_path: string }, ProjectRow>(`SELECT * FROM projects WHERE repo_path = :repo_path`),
  insert: db.prepare<Record<string, unknown>, ProjectRow>(
    `INSERT INTO projects (id, name, repo_path, repo_name, default_flow_id, created_at, updated_at)
     VALUES (:id, :name, :repo_path, :repo_name, :default_flow_id, :created_at, :updated_at)
     RETURNING *`,
  ),
  update: db.prepare<Record<string, unknown>, ProjectRow>(
    `UPDATE projects SET name = :name, default_flow_id = :default_flow_id, updated_at = :updated_at
     WHERE id = :id RETURNING *`,
  ),
  touch: db.prepare<{ id: string; updated_at: string }>(
    `UPDATE projects SET updated_at = :updated_at WHERE id = :id`,
  ),
  remove: db.prepare<{ id: string }>(`DELETE FROM projects WHERE id = :id`),
}

export function listProjects(): Project[] {
  return stmts.list.all().map(hydrate)
}

export function getProject(id: string): Project | undefined {
  const r = stmts.byId.get({ id })
  return r && hydrate(r)
}

export function getProjectByPath(repoPath: string): Project | undefined {
  const r = stmts.byPath.get({ repo_path: repoPath })
  return r && hydrate(r)
}

export function createProject(input: {
  name: string
  repoPath: string
  repoName: string
  defaultFlowId?: string | null
}): Project {
  const ts = now()
  return hydrate(
    stmts.insert.get({
      id: newId("proj"),
      name: input.name,
      repo_path: input.repoPath,
      repo_name: input.repoName,
      default_flow_id: input.defaultFlowId ?? null,
      created_at: ts,
      updated_at: ts,
    })!,
  )
}

export function updateProject(
  id: string,
  input: { name: string; defaultFlowId: string | null },
): Project | undefined {
  const r = stmts.update.get({
    id,
    name: input.name,
    default_flow_id: input.defaultFlowId,
    updated_at: now(),
  })
  return r && hydrate(r)
}

export function touchProject(id: string): void {
  stmts.touch.run({ id, updated_at: now() })
}

export function deleteProject(id: string): boolean {
  return stmts.remove.run({ id }).changes > 0
}
