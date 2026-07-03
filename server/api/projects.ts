import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { Router } from "express"
import { z } from "zod"
import {
  createProject,
  deleteProject,
  getProject,
  getProjectByPath,
  listProjects,
  updateProject,
} from "../db/repos/projects.ts"
import { asyncHandler, HttpError, parseBody, required } from "./_util.ts"

export const projectsRouter: Router = Router()

const createSchema = z.object({
  repoPath: z.string().min(1),
  name: z.string().optional(),
  defaultFlowId: z.string().nullable().optional(),
})

const updateSchema = z.object({
  name: z.string().min(1),
  defaultFlowId: z.string().nullable(),
})

projectsRouter.get(
  "/",
  asyncHandler((_req, res) => {
    res.json(listProjects())
  }),
)

/** Expand ~ and resolve relative paths from the home directory. */
function resolveFolder(input: string): string {
  let p = input.trim()
  if (p === "~") p = homedir()
  else if (p.startsWith("~/")) p = path.join(homedir(), p.slice(2))
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(homedir(), p)
}

projectsRouter.post(
  "/",
  asyncHandler((req, res) => {
    const input = parseBody(createSchema, req.body)
    const repoPath = resolveFolder(input.repoPath)
    if (!existsSync(repoPath)) {
      throw new HttpError(400, `Folder does not exist: ${repoPath}`)
    }
    if (!statSync(repoPath).isDirectory()) {
      throw new HttpError(400, `Not a folder: ${repoPath}`)
    }
    const existing = getProjectByPath(repoPath)
    if (existing) {
      res.json(existing)
      return
    }
    const project = createProject({
      name: input.name?.trim() || path.basename(repoPath),
      repoPath,
      repoName: path.basename(repoPath),
      defaultFlowId: input.defaultFlowId ?? null,
    })
    res.status(201).json(project)
  }),
)

projectsRouter.get(
  "/:id",
  asyncHandler((req, res) => {
    res.json(required(getProject(req.params.id), "Project not found"))
  }),
)

projectsRouter.patch(
  "/:id",
  asyncHandler((req, res) => {
    const input = parseBody(updateSchema, req.body)
    res.json(required(updateProject(req.params.id, input), "Project not found"))
  }),
)

projectsRouter.delete(
  "/:id",
  asyncHandler((req, res) => {
    if (!deleteProject(req.params.id)) throw new HttpError(404, "Project not found")
    res.status(204).end()
  }),
)
