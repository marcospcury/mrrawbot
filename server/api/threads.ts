import { Router } from "express"
import { z } from "zod"
import { DEFAULT_ROLE_ID, defaultSession, PROVIDERS, type SessionConfig } from "@shared/types.ts"
import { getProject } from "../db/repos/projects.ts"
import { listThreadChanges } from "../db/repos/changes.ts"
import { listMessages, clearMessages } from "../db/repos/messages.ts"
import { listRunsByThread } from "../db/repos/runs.ts"
import { getFolder } from "../db/repos/folders.ts"
import {
  createThread,
  deleteThread,
  getThread,
  listThreads,
  renameThread,
  setThreadArchived,
  setThreadBranch,
  setThreadFlow,
  setThreadFolder,
  setThreadSession,
} from "../db/repos/threads.ts"
import { asyncHandler, HttpError, parseBody, required } from "./_util.ts"

export const threadsRouter: Router = Router()

const sessionSchema = z.object({
  provider: z.enum(PROVIDERS as [string, ...string[]]),
  model: z.string(),
  effort: z.string().nullable(),
  fast: z.boolean().default(false),
  role: z.string().default(DEFAULT_ROLE_ID),
})

const createSchema = z.object({
  title: z.string().optional(),
  kind: z.enum(["build", "product-design"]).optional(),
  flowId: z.string().nullable().optional(),
  session: sessionSchema.nullable().optional(),
})

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  archived: z.boolean().optional(),
  flowId: z.string().nullable().optional(),
  session: sessionSchema.nullable().optional(),
  branchName: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
})

// Threads scoped under a project.
threadsRouter.get(
  "/projects/:projectId/threads",
  asyncHandler((req, res) => {
    required(getProject(req.params.projectId), "Project not found")
    const includeArchived = req.query.includeArchived === "1" || req.query.includeArchived === "true"
    res.json(listThreads(req.params.projectId, includeArchived))
  }),
)

threadsRouter.post(
  "/projects/:projectId/threads",
  asyncHandler((req, res) => {
    const project = required(getProject(req.params.projectId), "Project not found")
    const input = parseBody(createSchema, req.body)
    // New threads default to single-agent "quick run" mode (no flow). The user
    // picks provider/model/effort/writes in the chat header and just kicks off.
    // Product Design sessions never run flows; they keep a session config for
    // the provider/model/effort both personas share.
    const kind = input.kind ?? "build"
    const flowId = kind === "product-design" ? null : input.flowId !== undefined ? input.flowId : null
    const session = input.session !== undefined ? (input.session as SessionConfig) : defaultSession()
    const thread = createThread({
      projectId: project.id,
      title: input.title,
      kind,
      flowId,
      session: flowId ? null : session,
    })
    res.status(201).json(thread)
  }),
)

threadsRouter.get(
  "/threads/:id",
  asyncHandler((req, res) => {
    res.json(required(getThread(req.params.id), "Thread not found"))
  }),
)

threadsRouter.patch(
  "/threads/:id",
  asyncHandler((req, res) => {
    const input = parseBody(patchSchema, req.body)
    let thread = required(getThread(req.params.id), "Thread not found")
    if (input.title !== undefined) thread = renameThread(thread.id, input.title)!
    if (input.archived !== undefined) thread = setThreadArchived(thread.id, input.archived)!
    if (input.flowId !== undefined) thread = setThreadFlow(thread.id, input.flowId)!
    if (input.session !== undefined) thread = setThreadSession(thread.id, input.session as SessionConfig | null)!
    if (input.branchName !== undefined) thread = setThreadBranch(thread.id, input.branchName)!
    if (input.folderId !== undefined) {
      if (input.folderId !== null) {
        const folder = required(getFolder(input.folderId), "Folder not found")
        if (folder.projectId !== thread.projectId) throw new HttpError(400, "Folder belongs to another project")
      }
      thread = setThreadFolder(thread.id, input.folderId)!
    }
    res.json(thread)
  }),
)

threadsRouter.delete(
  "/threads/:id",
  asyncHandler((req, res) => {
    if (!deleteThread(req.params.id)) throw new HttpError(404, "Thread not found")
    res.status(204).end()
  }),
)

threadsRouter.get(
  "/threads/:id/messages",
  asyncHandler((req, res) => {
    required(getThread(req.params.id), "Thread not found")
    res.json(listMessages(req.params.id))
  }),
)

threadsRouter.delete(
  "/threads/:id/messages",
  asyncHandler((req, res) => {
    required(getThread(req.params.id), "Thread not found")
    clearMessages(req.params.id)
    res.status(204).end()
  }),
)

threadsRouter.get(
  "/threads/:id/runs",
  asyncHandler((req, res) => {
    required(getThread(req.params.id), "Thread not found")
    res.json(listRunsByThread(req.params.id))
  }),
)

threadsRouter.get(
  "/threads/:id/changes",
  asyncHandler((req, res) => {
    required(getThread(req.params.id), "Thread not found")
    res.json(listThreadChanges(req.params.id))
  }),
)
