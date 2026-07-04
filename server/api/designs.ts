import { rm } from "node:fs/promises"
import { lstat } from "node:fs/promises"
import path from "node:path"
import { Router } from "express"
import type { DesignInfo } from "@shared/types.ts"
import { deleteDesign, getDesign, listDesigns, upsertDesign } from "../db/repos/designs.ts"
import { getProject } from "../db/repos/projects.ts"
import { designTitle, listDesignDirs, projectDesignsDir } from "../services/designs.ts"
import { safeResolve } from "../services/paths.ts"
import { asyncHandler, HttpError, required } from "./_util.ts"

export const designsRouter: Router = Router()

function requireProject(projectId: string): string {
  return required(getProject(projectId), "Project not found").id
}

// A slug is a single directory name under the project's designs dir — never a path.
function resolveSlug(projectId: string, slug: string): string {
  const root = projectDesignsDir(projectId)
  const dir = safeResolveOr400(root, slug)
  if (path.dirname(dir) !== root) throw new HttpError(400, "Invalid design slug")
  return dir
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

designsRouter.get(
  "/projects/:id/designs",
  asyncHandler(async (req, res) => {
    const projectId = requireProject(req.params.id)
    const dirs = await listDesignDirs(projectId)
    const onDisk = new Set(dirs.map((d) => d.slug))

    // The DB indexes provenance; the filesystem is the artifact store. Drop
    // rows whose folder is gone and absorb folders that lack a row (e.g.
    // created outside a tracked run) so the gallery always matches reality.
    const rows = listDesigns(projectId)
    const indexed = new Map(rows.map((r) => [r.slug, r]))
    const out: DesignInfo[] = rows.filter((r) => onDisk.has(r.slug))
    for (const dir of dirs) {
      if (indexed.has(dir.slug)) continue
      out.push(upsertDesign({ projectId, slug: dir.slug, title: await designTitle(projectId, dir.slug) }))
    }
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    res.json(out)
  }),
)

// Static serving for the Design tab's embedded browser. Same contract as the
// repo preview endpoint: real MIME types so multi-page prototypes work, and a
// hard script ban so a previewed page can never call the mrrawbot API.
designsRouter.get(
  "/projects/:id/designs/:slug/preview/*",
  asyncHandler(async (req, res) => {
    const projectId = requireProject(req.params.id)
    const dir = resolveSlug(projectId, req.params.slug)
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

designsRouter.delete(
  "/projects/:id/designs/:slug",
  asyncHandler(async (req, res) => {
    const projectId = requireProject(req.params.id)
    required(getDesign(projectId, req.params.slug) ?? undefined, "Design not found")
    const dir = resolveSlug(projectId, req.params.slug)
    await rm(dir, { recursive: true, force: true })
    deleteDesign(projectId, req.params.slug)
    res.json({ ok: true })
  }),
)
