import type { AgentRunRecord, AgentRunState, RunStatus } from "@shared/types.ts"
import { db, now } from "../db.ts"

interface RunRow {
  id: string
  thread_id: string
  message_id: string | null
  flow_id: string | null
  status: string
  state: string
  created_at: string
}

function hydrate(r: RunRow): AgentRunRecord {
  return {
    id: r.id,
    threadId: r.thread_id,
    messageId: r.message_id,
    flowId: r.flow_id,
    status: r.status as RunStatus,
    state: JSON.parse(r.state) as AgentRunState,
    createdAt: r.created_at,
  }
}

const stmts = {
  byId: db.prepare<{ id: string }, RunRow>(`SELECT * FROM agent_runs WHERE id = :id`),
  byThread: db.prepare<{ thread_id: string }, RunRow>(
    `SELECT * FROM agent_runs WHERE thread_id = :thread_id ORDER BY created_at DESC`,
  ),
  upsert: db.prepare<Record<string, unknown>>(
    `INSERT INTO agent_runs (id, thread_id, message_id, flow_id, status, state, created_at)
     VALUES (:id, :thread_id, :message_id, :flow_id, :status, :state, :created_at)
     ON CONFLICT(id) DO UPDATE SET
       message_id = excluded.message_id, status = excluded.status, state = excluded.state`,
  ),
}

// Runs still marked 'running' at boot belong to a previous server process that
// died mid-run; mark them cancelled so rehydrated timelines don't show as live.
// Also close out steps left 'running' inside any terminal run's state (rows
// persisted before steps were finalized) so they don't render live spinners.
{
  const update = db.prepare<{ id: string; status: string; state: string }>(
    `UPDATE agent_runs SET status = :status, state = :state WHERE id = :id`,
  )
  for (const row of db.prepare<[], RunRow>(`SELECT * FROM agent_runs`).all()) {
    const state = JSON.parse(row.state) as AgentRunState
    let dirty = false
    if (state.status === "running") {
      state.status = "cancelled"
      state.activeStepId = null
      dirty = true
    }
    if (state.endedAt == null) {
      state.endedAt = Date.now()
      dirty = true
    }
    for (const step of state.steps) {
      if (step.status === "running") {
        step.status = state.status === "cancelled" ? "skipped" : "error"
        step.endedAt = step.endedAt ?? state.endedAt ?? Date.now()
        dirty = true
      }
    }
    if (dirty) update.run({ id: row.id, status: state.status, state: JSON.stringify(state) })
  }
}

export function saveRun(state: AgentRunState, messageId: string | null): void {
  stmts.upsert.run({
    id: state.runId,
    thread_id: state.threadId,
    message_id: messageId,
    flow_id: state.flowId,
    status: state.status,
    state: JSON.stringify(state),
    created_at: now(),
  })
}

export function getRun(id: string): AgentRunRecord | undefined {
  const r = stmts.byId.get({ id })
  return r && hydrate(r)
}

export function listRunsByThread(threadId: string): AgentRunRecord[] {
  return stmts.byThread.all({ thread_id: threadId }).map(hydrate)
}
