import { Router } from "express"
import { scanRepos } from "../services/gitRepos.ts"
import { asyncHandler } from "./_util.ts"

export const reposRouter: Router = Router()

reposRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const force = req.query.refresh === "1" || req.query.refresh === "true"
    res.json(await scanRepos(force))
  }),
)
