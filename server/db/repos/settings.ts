import { db, now } from "../db.ts"

const stmts = {
  get: db.prepare<{ key: string }, { value: string }>(`SELECT value FROM settings WHERE key = :key`),
  set: db.prepare<Record<string, unknown>>(
    `INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :updated_at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ),
  all: db.prepare<[], { key: string; value: string }>(`SELECT key, value FROM settings`),
  del: db.prepare<{ key: string }>(`DELETE FROM settings WHERE key = :key`),
}

export function getSetting<T>(key: string): T | undefined {
  const r = stmts.get.get({ key })
  return r ? (JSON.parse(r.value) as T) : undefined
}

export function setSetting<T>(key: string, value: T): void {
  stmts.set.run({ key, value: JSON.stringify(value), updated_at: now() })
}

export function deleteSetting(key: string): void {
  stmts.del.run({ key })
}

export function getAllSettings(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const row of stmts.all.all()) out[row.key] = JSON.parse(row.value)
  return out
}
