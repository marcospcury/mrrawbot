import type { ChatMessage, MessageRole } from "@shared/types.ts"
import { db, newId, now } from "../db.ts"

interface MessageRow {
  id: string
  thread_id: string
  role: string
  content: string
  run_id: string | null
  created_at: string
}

function hydrate(r: MessageRow): ChatMessage {
  return {
    id: r.id,
    threadId: r.thread_id,
    role: r.role as MessageRole,
    content: r.content,
    runId: r.run_id,
    createdAt: r.created_at,
  }
}

const stmts = {
  listByThread: db.prepare<{ thread_id: string }, MessageRow>(
    `SELECT * FROM messages WHERE thread_id = :thread_id ORDER BY created_at ASC, id ASC`,
  ),
  exists: db.prepare<{ id: string }, { id: string }>(`SELECT id FROM messages WHERE id = :id`),
  insert: db.prepare<Record<string, unknown>, MessageRow>(
    `INSERT INTO messages (id, thread_id, role, content, run_id, created_at)
     VALUES (:id, :thread_id, :role, :content, :run_id, :created_at)
     ON CONFLICT(id) DO UPDATE SET content = excluded.content, run_id = excluded.run_id
     RETURNING *`,
  ),
  deleteByThread: db.prepare<{ thread_id: string }>(`DELETE FROM messages WHERE thread_id = :thread_id`),
}

export function listMessages(threadId: string): ChatMessage[] {
  return stmts.listByThread.all({ thread_id: threadId }).map(hydrate)
}

export function messageExists(id: string): boolean {
  return !!stmts.exists.get({ id })
}

export function saveMessage(input: {
  id?: string
  threadId: string
  role: MessageRole
  content: string
  runId?: string | null
  createdAt?: string
}): ChatMessage {
  return hydrate(
    stmts.insert.get({
      id: input.id ?? newId("msg"),
      thread_id: input.threadId,
      role: input.role,
      content: input.content,
      run_id: input.runId ?? null,
      created_at: input.createdAt ?? now(),
    })!,
  )
}

export function clearMessages(threadId: string): void {
  stmts.deleteByThread.run({ thread_id: threadId })
}
