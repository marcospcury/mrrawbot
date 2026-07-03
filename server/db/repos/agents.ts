import type { AgentConfig, Effort, NewAgentConfig, Provider } from "@shared/types.ts"
import { db, newId, now } from "../db.ts"

interface AgentRow {
  id: string
  name: string
  provider: string
  model: string
  effort: string | null
  role: string
  system_prompt: string
  max_iterations: number
  temperature: number | null
  is_builtin: 0 | 1
  created_at: string
  updated_at: string
}

function hydrate(r: AgentRow): AgentConfig {
  return {
    id: r.id,
    name: r.name,
    provider: r.provider as Provider,
    model: r.model,
    effort: (r.effort as Effort | null) ?? null,
    role: r.role,
    systemPrompt: r.system_prompt,
    maxIterations: r.max_iterations,
    temperature: r.temperature,
    isBuiltin: r.is_builtin === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const stmts = {
  list: db.prepare<[], AgentRow>(`SELECT * FROM agents ORDER BY is_builtin DESC, name ASC`),
  byId: db.prepare<{ id: string }, AgentRow>(`SELECT * FROM agents WHERE id = :id`),
  insert: db.prepare<Record<string, unknown>, AgentRow>(
    `INSERT INTO agents (id, name, provider, model, effort, role, system_prompt, max_iterations, temperature, is_builtin, created_at, updated_at)
     VALUES (:id, :name, :provider, :model, :effort, :role, :system_prompt, :max_iterations, :temperature, :is_builtin, :created_at, :updated_at)
     RETURNING *`,
  ),
  update: db.prepare<Record<string, unknown>, AgentRow>(
    `UPDATE agents SET
       name = :name, provider = :provider, model = :model, effort = :effort, role = :role,
       system_prompt = :system_prompt,
       max_iterations = :max_iterations, temperature = :temperature, updated_at = :updated_at
     WHERE id = :id RETURNING *`,
  ),
  remove: db.prepare<{ id: string }>(`DELETE FROM agents WHERE id = :id AND is_builtin = 0`),
  removeBuiltin: db.prepare<{ id: string }>(`DELETE FROM agents WHERE id = :id AND is_builtin = 1`),
}

export function listAgents(): AgentConfig[] {
  return stmts.list.all().map(hydrate)
}

export function getAgent(id: string): AgentConfig | undefined {
  const r = stmts.byId.get({ id })
  return r && hydrate(r)
}

export function createAgent(input: NewAgentConfig, opts: { isBuiltin?: boolean; id?: string } = {}): AgentConfig {
  const ts = now()
  return hydrate(
    stmts.insert.get({
      id: opts.id ?? newId("agent"),
      name: input.name,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      role: input.role,
      system_prompt: input.systemPrompt,
      max_iterations: input.maxIterations,
      temperature: input.temperature,
      is_builtin: opts.isBuiltin ? 1 : 0,
      created_at: ts,
      updated_at: ts,
    })!,
  )
}

export function updateAgent(id: string, input: NewAgentConfig): AgentConfig | undefined {
  const r = stmts.update.get({
    id,
    name: input.name,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    role: input.role,
    system_prompt: input.systemPrompt,
    max_iterations: input.maxIterations,
    temperature: input.temperature,
    updated_at: now(),
  })
  return r && hydrate(r)
}

export function deleteAgent(id: string): boolean {
  return stmts.remove.run({ id }).changes > 0
}

/** Seeder-only: remove one builtin agent (e.g. before refreshing it in place). */
export function removeBuiltinAgent(id: string): void {
  stmts.removeBuiltin.run({ id })
}

export function countAgents(): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM agents`).get() as { c: number }).c
}
