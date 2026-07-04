// Design prototype storage. Artifacts produced by the Product/UI Designer role
// are app-internal: they live under `env.designsRoot/<projectId>/<slug>/`
// (next to the SQLite database), never inside a user repository. The
// filesystem is the artifact store; the `designs` table is the index.
import { mkdirSync } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import type { RunDesign } from "@shared/types.ts"
import { upsertDesign } from "../db/repos/designs.ts"
import { env } from "../env.ts"

export function projectDesignsDir(projectId: string): string {
  const dir = path.join(env.designsRoot, projectId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export interface DesignDirEntry {
  slug: string
  /** Newest mtime across the slug dir's direct children (file writes bump it). */
  mtimeMs: number
}

/** Slug directories under a project's designs dir that contain an index.html. */
export async function listDesignDirs(projectId: string): Promise<DesignDirEntry[]> {
  const root = projectDesignsDir(projectId)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const out: DesignDirEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    const index = await stat(path.join(dir, "index.html")).catch(() => null)
    if (!index?.isFile()) continue
    let mtimeMs = index.mtimeMs
    const children = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const child of children) {
      if (!child.isFile()) continue
      const st = await stat(path.join(dir, child.name)).catch(() => null)
      if (st && st.mtimeMs > mtimeMs) mtimeMs = st.mtimeMs
    }
    out.push({ slug: entry.name, mtimeMs })
  }
  return out
}

/** Human title for a design: its index.html <title>, falling back to the slug. */
export async function designTitle(projectId: string, slug: string): Promise<string> {
  const index = path.join(projectDesignsDir(projectId), slug, "index.html")
  const html = await readFile(index, "utf8").catch(() => "")
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = match?.[1]?.trim()
  return title || slug
}

export type DesignSnapshot = Map<string, number>

export async function snapshotDesigns(projectId: string): Promise<DesignSnapshot> {
  const dirs = await listDesignDirs(projectId)
  return new Map(dirs.map((d) => [d.slug, d.mtimeMs]))
}

/** Slugs that appeared or were touched between two snapshots. */
export function diffDesigns(before: DesignSnapshot, after: DesignSnapshot): string[] {
  const changed: string[] = []
  for (const [slug, mtimeMs] of after) {
    const prev = before.get(slug)
    if (prev === undefined || mtimeMs > prev) changed.push(slug)
  }
  return changed
}

export interface DesignTracker {
  /** Index designs the run created/updated; returns them for the run state. */
  finish(): Promise<RunDesign[]>
}

/**
 * Snapshot a project's designs at run start; `finish()` diffs against the
 * current state and upserts an index row (with thread/run provenance) for
 * every design the run landed. Indexing failures are logged, never thrown —
 * they must not take down a finished run.
 */
export async function createDesignTracker(input: {
  projectId: string
  threadId: string
  runId: string
}): Promise<DesignTracker> {
  const before = await snapshotDesigns(input.projectId).catch(() => new Map() as DesignSnapshot)
  return {
    async finish(): Promise<RunDesign[]> {
      try {
        const after = await snapshotDesigns(input.projectId)
        const landed: RunDesign[] = []
        for (const slug of diffDesigns(before, after)) {
          const title = await designTitle(input.projectId, slug)
          upsertDesign({ projectId: input.projectId, threadId: input.threadId, runId: input.runId, slug, title })
          landed.push({ slug, title })
        }
        return landed
      } catch (err) {
        console.error("[designs] failed to index run designs", err)
        return []
      }
    },
  }
}
