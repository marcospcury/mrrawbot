import type { ThreadChange, ThreadChangeStatus } from "@shared/types.ts"
import { db, newId, now } from "../db.ts"

interface ThreadChangeRow {
  id: string
  thread_id: string
  run_id: string | null
  file_path: string
  change_status: string
  before_content: string | null
  after_content: string | null
  before_missing: 0 | 1
  truncated: 0 | 1
  binary: 0 | 1
  created_at: string
}

function hydrate(r: ThreadChangeRow): ThreadChange {
  return {
    id: r.id,
    threadId: r.thread_id,
    runId: r.run_id,
    filePath: r.file_path,
    changeStatus: r.change_status as ThreadChangeStatus,
    beforeContent: r.before_content,
    afterContent: r.after_content,
    beforeMissing: r.before_missing === 1,
    truncated: r.truncated === 1,
    binary: r.binary === 1,
    createdAt: r.created_at,
  }
}

const stmts = {
  removeDuplicate: db.prepare<{ thread_id: string; run_id: string | null; file_path: string }>(
    `DELETE FROM thread_changes
      WHERE thread_id = :thread_id AND run_id IS :run_id AND file_path = :file_path`,
  ),
  insert: db.prepare<Record<string, unknown>, ThreadChangeRow>(
    `INSERT INTO thread_changes (
       id, thread_id, run_id, file_path, change_status, before_content, after_content,
       before_missing, truncated, binary, created_at
     )
     VALUES (
       :id, :thread_id, :run_id, :file_path, :change_status, :before_content, :after_content,
       :before_missing, :truncated, :binary, :created_at
     )
     RETURNING *`,
  ),
  listByThread: db.prepare<{ thread_id: string }, ThreadChangeRow>(
    `SELECT * FROM thread_changes
      WHERE thread_id = :thread_id
      ORDER BY created_at DESC, run_id DESC, file_path ASC`,
  ),
  deleteByThread: db.prepare<{ thread_id: string }>(`DELETE FROM thread_changes WHERE thread_id = :thread_id`),
}

const replaceThreadChange = db.transaction(
  (input: {
    threadId: string
    runId?: string | null
    filePath: string
    changeStatus: ThreadChangeStatus
    beforeContent?: string | null
    afterContent?: string | null
    beforeMissing?: boolean
    truncated?: boolean
    binary?: boolean
  }) => {
    const runId = input.runId ?? null
    stmts.removeDuplicate.run({ thread_id: input.threadId, run_id: runId, file_path: input.filePath })
    return hydrate(
      stmts.insert.get({
        id: newId("chg"),
        thread_id: input.threadId,
        run_id: runId,
        file_path: input.filePath,
        change_status: input.changeStatus,
        before_content: input.beforeContent ?? null,
        after_content: input.afterContent ?? null,
        before_missing: input.beforeMissing ? 1 : 0,
        truncated: input.truncated ? 1 : 0,
        binary: input.binary ? 1 : 0,
        created_at: now(),
      })!,
    )
  },
)

export function upsertThreadChange(input: {
  threadId: string
  runId?: string | null
  filePath: string
  changeStatus: ThreadChangeStatus
  beforeContent?: string | null
  afterContent?: string | null
  beforeMissing?: boolean
  truncated?: boolean
  binary?: boolean
}): ThreadChange {
  return replaceThreadChange(input)
}

export function listThreadChanges(threadId: string): ThreadChange[] {
  return stmts.listByThread.all({ thread_id: threadId }).map(hydrate)
}

export function deleteThreadChanges(threadId: string): void {
  stmts.deleteByThread.run({ thread_id: threadId })
}
