import { Router } from "express"
import { z } from "zod"
import { getProject } from "../db/repos/projects.ts"
import { projectGitService } from "../services/projectGit.ts"
import { asyncHandler, parseBody, required } from "./_util.ts"

export const projectGitRouter: Router = Router()

const branchSchema = z.object({
  name: z.string().min(1),
})

const createPullRequestSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  base: z.string().optional(),
})

const mergePullRequestSchema = z.object({
  confirm: z.boolean(),
  method: z.enum(["merge", "squash", "rebase"]),
  expectedHeadSha: z.string().min(1),
})

function project(id: string) {
  return required(getProject(id), "Project not found")
}

projectGitRouter.get(
  "/projects/:id/git/status",
  asyncHandler(async (req, res) => {
    res.json(await projectGitService.getStatus(project(req.params.id)))
  }),
)

projectGitRouter.post(
  "/projects/:id/git/branch",
  asyncHandler(async (req, res) => {
    const input = parseBody(branchSchema, req.body)
    res.status(201).json(await projectGitService.createBranch(project(req.params.id), input.name))
  }),
)

projectGitRouter.get(
  "/projects/:id/github/pr",
  asyncHandler(async (req, res) => {
    res.json(await projectGitService.getPullRequest(project(req.params.id)))
  }),
)

projectGitRouter.post(
  "/projects/:id/github/pr",
  asyncHandler(async (req, res) => {
    const input = parseBody(createPullRequestSchema, req.body)
    res.status(201).json(await projectGitService.createPullRequest(project(req.params.id), input))
  }),
)

projectGitRouter.post(
  "/projects/:id/github/pr/:number/merge",
  asyncHandler(async (req, res) => {
    const input = parseBody(mergePullRequestSchema, req.body)
    res.json(await projectGitService.mergePullRequest(project(req.params.id), Number(req.params.number), input))
  }),
)
