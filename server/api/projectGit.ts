import { Router, type Request } from "express"
import { z } from "zod"
import type { Project } from "@shared/types.ts"
import { getProject } from "../db/repos/projects.ts"
import { projectGitService } from "../services/projectGit.ts"
import { asyncHandler, parseBody, required } from "./_util.ts"

export const projectGitRouter: Router = Router()

const branchSchema = z.object({
  name: z.string().min(1),
})

const commitSchema = z.object({
  message: z.string().min(1),
  branchName: z.string().optional().nullable(),
})

const deleteBranchSchema = z.object({
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

type ProjectRouteHandler = (selectedProject: Project, req: Request) => Promise<unknown> | unknown

function projectJson(handler: ProjectRouteHandler, status = 200) {
  return asyncHandler(async (req, res) => {
    res.status(status).json(await handler(project(req.params.id), req))
  })
}

function refreshOptions(req: Request) {
  return { refresh: req.query.refresh !== "0" }
}

projectGitRouter.get(
  "/projects/:id/git/status",
  projectJson((selectedProject, req) => projectGitService.getStatus(selectedProject, refreshOptions(req))),
)

projectGitRouter.post(
  "/projects/:id/git/branch",
  projectJson((selectedProject, req) => {
    const input = parseBody(branchSchema, req.body)
    return projectGitService.createBranch(selectedProject, input.name)
  }, 201),
)

projectGitRouter.post(
  "/projects/:id/git/commit",
  projectJson((selectedProject, req) => {
    const input = parseBody(commitSchema, req.body)
    return projectGitService.commitChanges(selectedProject, input)
  }, 201),
)

projectGitRouter.post(
  "/projects/:id/git/push",
  projectJson((selectedProject) => projectGitService.pushCurrentBranch(selectedProject)),
)

projectGitRouter.post(
  "/projects/:id/git/checkout-default",
  projectJson((selectedProject) => projectGitService.checkoutDefaultBranch(selectedProject)),
)

projectGitRouter.post(
  "/projects/:id/git/pull-default",
  projectJson((selectedProject) => projectGitService.pullDefaultBranch(selectedProject)),
)

projectGitRouter.post(
  "/projects/:id/git/delete-branch",
  projectJson((selectedProject, req) => {
    const input = parseBody(deleteBranchSchema, req.body)
    return projectGitService.deleteLocalBranch(selectedProject, input.name)
  }),
)

projectGitRouter.get(
  "/projects/:id/github/pr",
  projectJson((selectedProject, req) => projectGitService.getPullRequest(selectedProject, refreshOptions(req))),
)

projectGitRouter.post(
  "/projects/:id/github/pr",
  projectJson((selectedProject, req) => {
    const input = parseBody(createPullRequestSchema, req.body)
    return projectGitService.createPullRequest(selectedProject, input)
  }, 201),
)

projectGitRouter.post(
  "/projects/:id/github/pr/:number/merge",
  projectJson((selectedProject, req) => {
    const input = parseBody(mergePullRequestSchema, req.body)
    return projectGitService.mergePullRequest(selectedProject, Number(req.params.number), input)
  }),
)
