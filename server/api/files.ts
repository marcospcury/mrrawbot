import { lstat, open, readdir } from "node:fs/promises"
import path from "node:path"
import { Router } from "express"
import { z } from "zod"
import type { FileContent, FileTreeEntry } from "@shared/types.ts"
import { getProject } from "../db/repos/projects.ts"
import { safeResolve } from "../services/paths.ts"
import { asyncHandler, HttpError, parseBody, required } from "./_util.ts"

export const filesRouter: Router = Router()

const MAX_CONTENT_BYTES = 400_000
const BINARY_SCAN_BYTES = 8_192
const SKIPPED_NAMES = new Set([".git", "node_modules", "dist", "build", "release", ".DS_Store"])

const listQuerySchema = z.object({
  dir: z.string().optional(),
})

const contentQuerySchema = z.object({
  path: z.string().min(1),
})

function projectRoot(projectId: string): string {
  const project = required(getProject(projectId), "Project not found")
  if (!project.repoPath) throw new HttpError(404, "Project repository not found")
  return project.repoPath
}

function resolveRepoPath(root: string, relPath: string): string {
  try {
    return safeResolve(root, relPath)
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
}

function toRelativePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/")
}

function sortEntries(a: FileTreeEntry, b: FileTreeEntry): number {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1
  return a.name.localeCompare(b.name)
}

function filesystemError(e: unknown): never {
  const err = e as NodeJS.ErrnoException
  if (err instanceof HttpError) throw err
  if (err.code === "ENOENT") throw new HttpError(404, "Path not found")
  if (err.code === "ENOTDIR") throw new HttpError(400, "Path is not a directory")
  if (err.code === "EACCES" || err.code === "EPERM") throw new HttpError(403, "Path is not readable")
  throw err
}

filesRouter.get(
  "/projects/:id/files",
  asyncHandler(async (req, res) => {
    const root = projectRoot(req.params.id)
    const input = parseBody(listQuerySchema, req.query)
    const dirPath = resolveRepoPath(root, input.dir ?? ".")

    const entries = await readdir(dirPath, { withFileTypes: true }).catch(filesystemError)
    const tree: FileTreeEntry[] = entries
      .filter((entry) => !SKIPPED_NAMES.has(entry.name) && !entry.isSymbolicLink())
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => ({
        name: entry.name,
        path: toRelativePath(root, path.join(dirPath, entry.name)),
        type: entry.isDirectory() ? ("dir" as const) : ("file" as const),
      }))
      .sort(sortEntries)

    res.json(tree)
  }),
)

// Static preview of repository files (the file viewer's "open in preview"
// for repo HTML). Serves any repo file with its real MIME type so multi-page
// documents with relative links and stylesheets work as real pages. Design
// prototypes are served by the designs router from the app-internal store.
filesRouter.get(
  "/projects/:id/preview/*",
  asyncHandler(async (req, res) => {
    const root = projectRoot(req.params.id)
    const rel = req.params[0] || "."
    let filePath = resolveRepoPath(root, rel)

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

    // Previewed files are agent- or repo-authored content served on the app's
    // own origin, and the prototype contract is pure HTML+CSS — block script
    // execution outright so a previewed page can never call the mrrawbot API.
    res.setHeader("Content-Security-Policy", "script-src 'none'")
    await new Promise<void>((resolve, reject) => {
      // Once headers are out there is no response left to repair, so stream
      // errors (e.g. the viewer closed mid-transfer) are dropped, not rethrown.
      res.sendFile(filePath, (err) => (err && !res.headersSent ? reject(err) : resolve()))
    }).catch(filesystemError)
  }),
)

filesRouter.get(
  "/projects/:id/file",
  asyncHandler(async (req, res) => {
    const root = projectRoot(req.params.id)
    const input = parseBody(contentQuerySchema, req.query)
    const filePath = resolveRepoPath(root, input.path)

    const fileStat = await lstat(filePath).catch(filesystemError)
    if (fileStat.isSymbolicLink()) throw new HttpError(400, "Symlinks are not supported")

    const handle = await open(filePath, "r").catch(filesystemError)
    try {
      const stat = await handle.stat()
      if (stat.isDirectory()) throw new HttpError(400, "Path is a directory")
      if (!stat.isFile()) throw new HttpError(400, "Path is not a file")

      const readLength = Math.min(stat.size, MAX_CONTENT_BYTES)
      const buffer = Buffer.alloc(readLength)
      const { bytesRead } = await handle.read(buffer, 0, readLength, 0)
      const data = buffer.subarray(0, bytesRead)
      const binaryScan = data.subarray(0, Math.min(data.length, BINARY_SCAN_BYTES))
      const binary = binaryScan.includes(0)
      const response: FileContent = {
        path: toRelativePath(root, filePath),
        content: binary ? "" : data.toString("utf8"),
        truncated: stat.size > MAX_CONTENT_BYTES,
        binary,
        size: stat.size,
      }

      res.json(response)
    } finally {
      await handle.close()
    }
  }),
)
