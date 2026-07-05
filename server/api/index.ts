import { readFileSync } from "node:fs"
import path from "node:path"
import { Router } from "express"
import type { AppInfo } from "@shared/types.ts"
import { COPILOT_RUNTIME_PATH, env, ROOT_DIR } from "../env.ts"
import { getModelEntries } from "../services/providers/status.ts"
import { agentsRouter } from "./agents.ts"
import { artifactsRouter } from "./artifacts.ts"
import { filesRouter } from "./files.ts"
import { flowsRouter } from "./flows.ts"
import { projectsRouter } from "./projects.ts"
import { providersRouter } from "./providers.ts"
import { projectGitRouter } from "./projectGit.ts"
import { reposRouter } from "./repos.ts"
import { threadsRouter } from "./threads.ts"
import { uploadsRouter } from "./uploads.ts"
import { asyncHandler } from "./_util.ts"

const pkg = JSON.parse(readFileSync(path.join(ROOT_DIR, "package.json"), "utf8")) as {
  version: string
}

export function makeApiRouter(): Router {
  const r = Router()

  r.get("/info", (_req, res) => {
    const info: AppInfo = {
      name: "mrrawbot",
      version: pkg.version,
      repoRoots: env.repoRoots,
      dbPath: env.dbPath,
      copilotRuntimeUrl: COPILOT_RUNTIME_PATH,
    }
    res.json(info)
  })

  r.get("/health", (_req, res) => res.json({ ok: true }))
  r.get("/models", asyncHandler(async (_req, res) => res.json(await getModelEntries())))

  r.use("/repos", reposRouter)
  r.use("/projects", projectsRouter)
  r.use("/agents", agentsRouter)
  r.use("/flows", flowsRouter)
  r.use("/providers", providersRouter)
  r.use("/", projectGitRouter)
  // filesRouter, artifactsRouter, uploadsRouter and threadsRouter define fully-qualified paths
  // (/projects/:id/..., /threads/:id/...).
  r.use("/", artifactsRouter)
  r.use("/", filesRouter)
  r.use("/", uploadsRouter)
  r.use("/", threadsRouter)

  return r
}
