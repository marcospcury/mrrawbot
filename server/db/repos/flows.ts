import type { Effort, FlowConfig, FlowStep, FlowStepLoop, NewFlowConfig, Provider } from "@shared/types.ts"
import { db, newId, now } from "../db.ts"
import { getSetting, setSetting } from "./settings.ts"

interface FlowRow {
  id: string
  name: string
  description: string
  definition: string
  is_builtin: 0 | 1
  created_at: string
  updated_at: string
}

const VALID_PROVIDERS: Provider[] = ["claude", "codex", "ollama"]
const DELETED_BUILTIN_FLOW_IDS_KEY = "deletedBuiltinFlowIds"

/** Coerce a raw stored step into a complete, valid FlowStep (tolerant of older shapes). */
function normalizeStep(raw: unknown, index: number): FlowStep | null {
  if (!raw || typeof raw !== "object") return null
  const s = raw as Record<string, unknown>
  const provider = VALID_PROVIDERS.includes(s.provider as Provider) ? (s.provider as Provider) : null
  if (!provider) return null // drop legacy {agentId}-only steps that can't be resolved
  const loop =
    s.loop && typeof s.loop === "object" && (s.loop as Record<string, unknown>).to
      ? ({
          to: String((s.loop as Record<string, unknown>).to),
          approveWhen: String((s.loop as Record<string, unknown>).approveWhen ?? "APPROVE"),
          maxLoops: Number((s.loop as Record<string, unknown>).maxLoops ?? 2),
        } as FlowStepLoop)
      : null
  return {
    id: typeof s.id === "string" && s.id ? s.id : `step_${index}_${newId()}`,
    name: typeof s.name === "string" && s.name ? s.name : `Step ${index + 1}`,
    provider,
    model: String(s.model ?? ""),
    effort: (s.effort as Effort | null) ?? null,
    fast: Boolean(s.fast),
    // Default to "" (custom) so legacy steps keep using their own systemPrompt
    // verbatim rather than suddenly gaining a role's prompt.
    role: typeof s.role === "string" ? s.role : "",
    systemPrompt: String(s.systemPrompt ?? ""),
    maxIterations: Number(s.maxIterations ?? 12),
    temperature: s.temperature == null ? null : Number(s.temperature),
    mode: s.mode === "plan-executor" ? "plan-executor" : "single",
    maxCompletionPasses: Number(s.maxCompletionPasses ?? 10),
    loop,
  }
}

function hydrate(r: FlowRow): FlowConfig {
  const def = JSON.parse(r.definition) as { steps?: unknown[] }
  const steps = Array.isArray(def.steps)
    ? def.steps.map((s, i) => normalizeStep(s, i)).filter((s): s is FlowStep => s !== null)
    : []
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    steps,
    isBuiltin: r.is_builtin === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** Ensure every step has a stable id before persisting. */
function withIds(steps: FlowStep[]): FlowStep[] {
  return steps.map((s, i) => ({ ...s, id: s.id || `step_${i}_${newId()}` }))
}

const stmts = {
  list: db.prepare<[], FlowRow>(`SELECT * FROM flows ORDER BY is_builtin DESC, name ASC`),
  byId: db.prepare<{ id: string }, FlowRow>(`SELECT * FROM flows WHERE id = :id`),
  insert: db.prepare<Record<string, unknown>, FlowRow>(
    `INSERT INTO flows (id, name, description, definition, is_builtin, created_at, updated_at)
     VALUES (:id, :name, :description, :definition, :is_builtin, :created_at, :updated_at)
     RETURNING *`,
  ),
  update: db.prepare<Record<string, unknown>, FlowRow>(
    `UPDATE flows SET name = :name, description = :description, definition = :definition, updated_at = :updated_at
     WHERE id = :id RETURNING *`,
  ),
  remove: db.prepare<{ id: string }>(`DELETE FROM flows WHERE id = :id`),
  removeBuiltin: db.prepare<{ id: string }>(`DELETE FROM flows WHERE id = :id AND is_builtin = 1`),
}

export function listFlows(): FlowConfig[] {
  return stmts.list.all().map(hydrate)
}

export function getFlow(id: string): FlowConfig | undefined {
  const r = stmts.byId.get({ id })
  return r && hydrate(r)
}

export function createFlow(input: NewFlowConfig, opts: { isBuiltin?: boolean; id?: string } = {}): FlowConfig {
  const ts = now()
  return hydrate(
    stmts.insert.get({
      id: opts.id ?? newId("flow"),
      name: input.name,
      description: input.description,
      definition: JSON.stringify({ steps: withIds(input.steps) }),
      is_builtin: opts.isBuiltin ? 1 : 0,
      created_at: ts,
      updated_at: ts,
    })!,
  )
}

export function updateFlow(id: string, input: NewFlowConfig): FlowConfig | undefined {
  const r = stmts.update.get({
    id,
    name: input.name,
    description: input.description,
    definition: JSON.stringify({ steps: withIds(input.steps) }),
    updated_at: now(),
  })
  return r && hydrate(r)
}

export function deleteFlow(id: string): boolean {
  const flow = getFlow(id)
  const deleted = stmts.remove.run({ id }).changes > 0
  if (deleted && flow?.isBuiltin) rememberDeletedBuiltinFlow(id)
  return deleted
}

/**
 * Seeder-only: remove one builtin flow WITHOUT tombstoning it (unlike
 * `deleteFlow`, which records a user's builtin deletion so refreshes respect it).
 */
export function removeBuiltinFlow(id: string): void {
  stmts.removeBuiltin.run({ id })
}

export function countFlows(): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM flows`).get() as { c: number }).c
}

export function listDeletedBuiltinFlowIds(): string[] {
  return getSetting<string[]>(DELETED_BUILTIN_FLOW_IDS_KEY) ?? []
}

function rememberDeletedBuiltinFlow(id: string): void {
  const ids = new Set(listDeletedBuiltinFlowIds())
  ids.add(id)
  setSetting(DELETED_BUILTIN_FLOW_IDS_KEY, [...ids])
}
