import Database, { type Database as DB } from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { env } from "../env.ts"

mkdirSync(dirname(env.dbPath), { recursive: true })

export const db: DB = new Database(env.dbPath, { timeout: 5000 })

// Per-connection PRAGMAs — must be set outside any transaction.
db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")
db.pragma("busy_timeout = 5000")
db.pragma("synchronous = NORMAL")

// migrations[i] upgrades schema version i -> i+1. Append-only; never edit past entries.
const migrations: string[] = [
  // ---- v1: full initial schema ----
  `
  CREATE TABLE projects (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    repo_path       TEXT NOT NULL,
    repo_name       TEXT NOT NULL,
    default_flow_id TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) STRICT;

  CREATE TABLE flows (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    definition  TEXT NOT NULL DEFAULT '{"steps":[]}' CHECK (json_valid(definition)),
    is_builtin  INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0,1)),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) STRICT;

  CREATE TABLE agents (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    provider       TEXT NOT NULL CHECK (provider IN ('ollama','codex','claude')),
    model          TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT '',
    system_prompt  TEXT NOT NULL DEFAULT '',
    write_access   INTEGER NOT NULL DEFAULT 0 CHECK (write_access IN (0,1)),
    max_iterations INTEGER NOT NULL DEFAULT 12,
    temperature    REAL,
    is_builtin     INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0,1)),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) STRICT;

  CREATE TABLE threads (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
    flow_id    TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) STRICT;
  CREATE INDEX idx_threads_project ON threads(project_id, archived, updated_at DESC);

  CREATE TABLE messages (
    id         TEXT PRIMARY KEY,
    thread_id  TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
    content    TEXT NOT NULL,
    run_id     TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) STRICT;
  CREATE INDEX idx_messages_thread ON messages(thread_id, created_at);

  CREATE TABLE agent_runs (
    id         TEXT PRIMARY KEY,
    thread_id  TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    message_id TEXT,
    flow_id    TEXT,
    status     TEXT NOT NULL,
    state      TEXT NOT NULL CHECK (json_valid(state)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) STRICT;
  CREATE INDEX idx_runs_thread ON agent_runs(thread_id, created_at DESC);

  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL CHECK (json_valid(value)),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) STRICT;
  `,
  // ---- v2: per-agent reasoning effort ----
  `ALTER TABLE agents ADD COLUMN effort TEXT;`,
  // ---- v3: single-agent "quick run" config per thread (JSON or NULL) ----
  `ALTER TABLE threads ADD COLUMN session TEXT;`,
  // ---- v4: drop per-agent permission gating (agents always have full access) ----
  `ALTER TABLE agents DROP COLUMN write_access;`,
  // ---- v5: per-thread file changes captured from agent runs ----
  `
  CREATE TABLE thread_changes (
    id             TEXT PRIMARY KEY,
    thread_id      TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    run_id         TEXT,
    file_path      TEXT NOT NULL,
    change_status  TEXT NOT NULL CHECK (change_status IN ('added','modified','deleted')),
    before_content TEXT,
    after_content  TEXT,
    before_missing INTEGER NOT NULL DEFAULT 0,
    truncated      INTEGER NOT NULL DEFAULT 0,
    binary         INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
  ) STRICT;
  CREATE INDEX idx_thread_changes_thread_run ON thread_changes(thread_id, run_id);
  `,
  // ---- v6: one-shot generated thread titles, without blocking later manual renames ----
  `
  ALTER TABLE threads ADD COLUMN auto_title_generated_at TEXT;
  ALTER TABLE threads ADD COLUMN title_manually_edited INTEGER NOT NULL DEFAULT 0 CHECK (title_manually_edited IN (0,1));
  `,
  // ---- v7: design prototypes index (artifacts live app-internal under env.designsRoot) ----
  `
  CREATE TABLE designs (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    thread_id  TEXT,
    run_id     TEXT,
    slug       TEXT NOT NULL,
    title      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(project_id, slug)
  ) STRICT;
  CREATE INDEX idx_designs_project ON designs(project_id, updated_at DESC);
  `,
]

export function migrate(database: DB = db): void {
  const current = database.pragma("user_version", { simple: true }) as number
  for (let v = current; v < migrations.length; v++) {
    const sql = migrations[v]
    const apply = database.transaction(() => {
      database.exec(sql)
      database.pragma(`user_version = ${v + 1}`)
    })
    apply()
  }
}

// Run migrations at module load so the schema exists before any repository module
// (imported transitively) prepares its statements.
migrate()

let closed = false
export function closeDb(): void {
  if (closed || !db.open) return
  closed = true
  try {
    db.pragma("wal_checkpoint(TRUNCATE)")
  } catch {
    /* ignore */
  }
  db.close()
}

process.once("exit", closeDb)
process.once("SIGINT", () => {
  closeDb()
  process.exit(0)
})
process.once("SIGTERM", () => {
  closeDb()
  process.exit(0)
})

export function now(): string {
  return new Date().toISOString()
}

export function newId(prefix = ""): string {
  const id = crypto.randomUUID()
  return prefix ? `${prefix}_${id}` : id
}
