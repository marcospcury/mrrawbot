import { rm } from "node:fs/promises"
import { lstat, readFile } from "node:fs/promises"
import path from "node:path"
import { Router } from "express"
import { z } from "zod"
import { ARTIFACT_KINDS, type ArtifactInfo, type ArtifactKind } from "@shared/types.ts"
import {
  deleteArtifact,
  getArtifact,
  getArtifactById,
  listArtifacts,
  listThreadArtifacts,
  setThreadArtifacts,
  upsertArtifact,
} from "../db/repos/artifacts.ts"
import { getProject } from "../db/repos/projects.ts"
import { getThread } from "../db/repos/threads.ts"
import { artifactTitle, listArtifactEntries, projectArtifactsDir } from "../services/artifacts.ts"
import { safeResolve } from "../services/paths.ts"
import { asyncHandler, HttpError, parseBody, required } from "./_util.ts"

export const artifactsRouter: Router = Router()

function requireProject(projectId: string): string {
  return required(getProject(projectId), "Project not found").id
}

function parseKind(raw: string): ArtifactKind {
  if (!(ARTIFACT_KINDS as string[]).includes(raw)) throw new HttpError(400, "Invalid artifact kind")
  return raw as ArtifactKind
}

// A slug is a single directory name under the project's artifacts dir — never a path.
function resolvePrototypeDir(projectId: string, slug: string): string {
  const root = projectArtifactsDir(projectId)
  const dir = safeResolveOr400(root, slug)
  if (path.dirname(dir) !== root) throw new HttpError(400, "Invalid artifact slug")
  return dir
}

// Markdown artifacts live as `<slug>.md` directly inside the reserved dir.
function resolveMarkdownFile(projectId: string, kind: "spec" | "prompt", slug: string): string {
  const dir = path.join(projectArtifactsDir(projectId), kind === "spec" ? "specs" : "prompts")
  const file = safeResolveOr400(dir, `${slug}.md`)
  if (path.dirname(file) !== dir) throw new HttpError(400, "Invalid artifact slug")
  return file
}

function safeResolveOr400(root: string, rel: string): string {
  try {
    return safeResolve(root, rel)
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
}

function filesystemError(e: unknown): never {
  const err = e as NodeJS.ErrnoException
  if (err instanceof HttpError) throw err
  if (err.code === "ENOENT") throw new HttpError(404, "Path not found")
  if (err.code === "EACCES" || err.code === "EPERM") throw new HttpError(403, "Path is not readable")
  throw err
}

artifactsRouter.get(
  "/projects/:id/artifacts",
  asyncHandler(async (req, res) => {
    const projectId = requireProject(req.params.id)
    const entries = await listArtifactEntries(projectId)
    const onDisk = new Set(entries.map((e) => `${e.kind}:${e.slug}`))

    // The DB indexes provenance; the filesystem is the artifact store. Drop
    // rows whose files are gone and absorb files that lack a row (e.g.
    // created outside a tracked run) so the gallery always matches reality.
    const rows = listArtifacts(projectId)
    const indexed = new Set(rows.map((r) => `${r.kind}:${r.slug}`))
    const out: ArtifactInfo[] = rows.filter((r) => onDisk.has(`${r.kind}:${r.slug}`))
    for (const entry of entries) {
      if (indexed.has(`${entry.kind}:${entry.slug}`)) continue
      out.push(
        upsertArtifact({
          projectId,
          kind: entry.kind,
          slug: entry.slug,
          title: await artifactTitle(projectId, entry.kind, entry.slug),
        }),
      )
    }
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    res.json(out)
  }),
)

// Static serving for the Artifacts tab's embedded prototype browser. Same
// contract as the repo preview endpoint: real MIME types so multi-page
// prototypes work, and a hard script ban so a previewed page can never call
// the mrrawbot API.
artifactsRouter.get(
  "/projects/:id/artifacts/:slug/preview/*",
  asyncHandler(async (req, res) => {
    const projectId = requireProject(req.params.id)
    const dir = resolvePrototypeDir(projectId, req.params.slug)
    const rel = req.params[0] || "."
    let filePath = safeResolveOr400(dir, rel)

    let stat = await lstat(filePath).catch(filesystemError)
    if (stat.isSymbolicLink()) throw new HttpError(400, "Symlinks are not supported")
    if (stat.isDirectory()) {
      // Redirect to the trailing-slash form first so the page's relative links
      // resolve against the directory, then serve its index.html.
      const q = req.originalUrl.indexOf("?")
      const pathname = q === -1 ? req.originalUrl : req.originalUrl.slice(0, q)
      if (!pathname.endsWith("/")) {
        res.redirect(302, `${pathname}/${q === -1 ? "" : req.originalUrl.slice(q)}`)
        return
      }
      filePath = path.join(filePath, "index.html")
      stat = await lstat(filePath).catch(filesystemError)
      if (stat.isSymbolicLink()) throw new HttpError(400, "Symlinks are not supported")
    }
    if (!stat.isFile()) throw new HttpError(400, "Path is not a file")

    res.setHeader("Content-Security-Policy", "script-src 'none'")
    await new Promise<void>((resolve, reject) => {
      // Once headers are out there is no response left to repair, so stream
      // errors (e.g. the viewer closed mid-transfer) are dropped, not rethrown.
      res.sendFile(filePath, (err) => (err && !res.headersSent ? reject(err) : resolve()))
    }).catch(filesystemError)
  }),
)

// Raw markdown for spec/prompt artifacts (viewer + "copy prompt").
artifactsRouter.get(
  "/projects/:id/artifacts/:kind/:slug/content",
  asyncHandler(async (req, res) => {
    const projectId = requireProject(req.params.id)
    const kind = parseKind(req.params.kind)
    if (kind === "prototype") throw new HttpError(400, "Prototypes are served via the preview endpoint")
    const file = resolveMarkdownFile(projectId, kind, req.params.slug)
    const content = await readFile(file, "utf8").catch(filesystemError)
    res.json({ content })
  }),
)

artifactsRouter.delete(
  "/projects/:id/artifacts/:kind/:slug",
  asyncHandler(async (req, res) => {
    const projectId = requireProject(req.params.id)
    const kind = parseKind(req.params.kind)
    required(getArtifact(projectId, kind, req.params.slug) ?? undefined, "Artifact not found")
    const target =
      kind === "prototype"
        ? resolvePrototypeDir(projectId, req.params.slug)
        : resolveMarkdownFile(projectId, kind, req.params.slug)
    await rm(target, { recursive: true, force: true })
    deleteArtifact(projectId, kind, req.params.slug)
    res.json({ ok: true })
  }),
)

// Build-thread attachments: the artifacts injected into the thread's runs.
artifactsRouter.get(
  "/threads/:id/artifacts",
  asyncHandler((req, res) => {
    required(getThread(req.params.id), "Thread not found")
    res.json(listThreadArtifacts(req.params.id))
  }),
)

const attachSchema = z.object({ artifactIds: z.array(z.string()) })

artifactsRouter.put(
  "/threads/:id/artifacts",
  asyncHandler((req, res) => {
    const thread = required(getThread(req.params.id), "Thread not found")
    const input = parseBody(attachSchema, req.body)
    for (const id of input.artifactIds) {
      const artifact = required(getArtifactById(id) ?? undefined, `Artifact not found: ${id}`)
      if (artifact.projectId !== thread.projectId)
        throw new HttpError(400, "Artifact belongs to a different project")
    }
    setThreadArtifacts(thread.id, input.artifactIds)
    res.json(listThreadArtifacts(thread.id))
  }),
)
