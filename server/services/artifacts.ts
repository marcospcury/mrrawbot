// Product Design artifact storage. Artifacts produced by Product Design
// sessions are app-internal: prototypes live under
// `env.artifactsRoot/<projectId>/<slug>/`, specs and build prompts as markdown
// under `env.artifactsRoot/<projectId>/{specs,prompts}/` (next to the SQLite
// database), never inside a user repository. The filesystem is the artifact
// store; the `artifacts` table is the index.
import { mkdirSync } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import type { ArtifactKind, RunArtifact } from "@shared/types.ts"
import { upsertArtifact } from "../db/repos/artifacts.ts"
import { env } from "../env.ts"

/** Directory names under a project's artifacts dir reserved for markdown kinds. */
export const RESERVED_ARTIFACT_DIRS = ["specs", "prompts"] as const

export function projectArtifactsDir(projectId: string): string {
  const dir = path.join(env.artifactsRoot, projectId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Absolute path holding an artifact's files: the slug dir for prototypes, the markdown file otherwise. */
export function artifactPath(projectId: string, kind: ArtifactKind, slug: string): string {
  const root = projectArtifactsDir(projectId)
  if (kind === "prototype") return path.join(root, slug)
  return path.join(root, kind === "spec" ? "specs" : "prompts", `${slug}.md`)
}

export interface ArtifactEntry {
  kind: ArtifactKind
  slug: string
  /** Newest mtime across the artifact's files (writes bump it). */
  mtimeMs: number
}

/** Slug directories under a project's artifacts dir that contain an index.html. */
async function listPrototypeDirs(root: string): Promise<ArtifactEntry[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const out: ArtifactEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if ((RESERVED_ARTIFACT_DIRS as readonly string[]).includes(entry.name)) continue
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
    out.push({ kind: "prototype", slug: entry.name, mtimeMs })
  }
  return out
}

/** Flat `<slug>.md` files under the given reserved dir. */
async function listMarkdownArtifacts(root: string, kind: "spec" | "prompt"): Promise<ArtifactEntry[]> {
  const dir = path.join(root, kind === "spec" ? "specs" : "prompts")
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out: ArtifactEntry[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const st = await stat(path.join(dir, entry.name)).catch(() => null)
    if (!st) continue
    out.push({ kind, slug: entry.name.slice(0, -3), mtimeMs: st.mtimeMs })
  }
  return out
}

/** Every artifact currently on disk for a project, across all kinds. */
export async function listArtifactEntries(projectId: string): Promise<ArtifactEntry[]> {
  const root = projectArtifactsDir(projectId)
  const [prototypes, specs, prompts] = await Promise.all([
    listPrototypeDirs(root),
    listMarkdownArtifacts(root, "spec"),
    listMarkdownArtifacts(root, "prompt"),
  ])
  return [...prototypes, ...specs, ...prompts]
}

/**
 * Human title for an artifact: prototypes use their index.html <title>,
 * specs/prompts their first `# ` heading; both fall back to the slug.
 */
export async function artifactTitle(projectId: string, kind: ArtifactKind, slug: string): Promise<string> {
  if (kind === "prototype") {
    const index = path.join(projectArtifactsDir(projectId), slug, "index.html")
    const html = await readFile(index, "utf8").catch(() => "")
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    const title = match?.[1]?.trim()
    return title || slug
  }
  const md = await readFile(artifactPath(projectId, kind, slug), "utf8").catch(() => "")
  const match = md.match(/^#\s+(.+)$/m)
  const title = match?.[1]?.trim()
  return title || slug
}

export type ArtifactSnapshot = Map<string, number>

function snapshotKey(kind: ArtifactKind, slug: string): string {
  return `${kind}:${slug}`
}

export async function snapshotArtifacts(projectId: string): Promise<ArtifactSnapshot> {
  const entries = await listArtifactEntries(projectId)
  return new Map(entries.map((e) => [snapshotKey(e.kind, e.slug), e.mtimeMs]))
}

/** Artifacts that appeared or were touched between two snapshots. */
export function diffArtifacts(before: ArtifactSnapshot, after: ArtifactSnapshot): Array<{ kind: ArtifactKind; slug: string }> {
  const changed: Array<{ kind: ArtifactKind; slug: string }> = []
  for (const [key, mtimeMs] of after) {
    const prev = before.get(key)
    if (prev === undefined || mtimeMs > prev) {
      const sep = key.indexOf(":")
      changed.push({ kind: key.slice(0, sep) as ArtifactKind, slug: key.slice(sep + 1) })
    }
  }
  return changed
}

export interface ArtifactTracker {
  /** Index artifacts the run created/updated; returns them for the run state. */
  finish(): Promise<RunArtifact[]>
}

/**
 * Snapshot a project's artifacts at run start; `finish()` diffs against the
 * current state and upserts an index row (with thread/run provenance) for
 * every artifact the run landed. Indexing failures are logged, never thrown —
 * they must not take down a finished run.
 */
export async function createArtifactTracker(input: {
  projectId: string
  threadId: string
  runId: string
}): Promise<ArtifactTracker> {
  const before = await snapshotArtifacts(input.projectId).catch(() => new Map() as ArtifactSnapshot)
  return {
    async finish(): Promise<RunArtifact[]> {
      try {
        const after = await snapshotArtifacts(input.projectId)
        const landed: RunArtifact[] = []
        for (const { kind, slug } of diffArtifacts(before, after)) {
          const title = await artifactTitle(input.projectId, kind, slug)
          upsertArtifact({
            projectId: input.projectId,
            threadId: input.threadId,
            runId: input.runId,
            kind,
            slug,
            title,
          })
          landed.push({ kind, slug, title })
        }
        return landed
      } catch (err) {
        console.error("[artifacts] failed to index run artifacts", err)
        return []
      }
    },
  }
}
