import { Router } from "express"
import { z } from "zod"
import { getProject } from "../db/repos/projects.ts"
import { createFolder, deleteFolder, getFolder, listFolders, renameFolder } from "../db/repos/folders.ts"
import { asyncHandler, HttpError, parseBody, required } from "./_util.ts"

export const foldersRouter: Router = Router()

const folderSchema = z.object({
  name: z.string().min(1).max(80),
})

foldersRouter.get(
  "/projects/:projectId/folders",
  asyncHandler((req, res) => {
    required(getProject(req.params.projectId), "Project not found")
    res.json(listFolders(req.params.projectId))
  }),
)

foldersRouter.post(
  "/projects/:projectId/folders",
  asyncHandler((req, res) => {
    const project = required(getProject(req.params.projectId), "Project not found")
    const input = parseBody(folderSchema, req.body)
    res.status(201).json(createFolder({ projectId: project.id, name: input.name }))
  }),
)

foldersRouter.patch(
  "/folders/:id",
  asyncHandler((req, res) => {
    required(getFolder(req.params.id), "Folder not found")
    const input = parseBody(folderSchema, req.body)
    res.json(renameFolder(req.params.id, input.name))
  }),
)

foldersRouter.delete(
  "/folders/:id",
  asyncHandler((req, res) => {
    if (!deleteFolder(req.params.id)) throw new HttpError(404, "Folder not found")
    res.status(204).end()
  }),
)
