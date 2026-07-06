import { Router } from "express"
import type { ProviderConfigPatch } from "@shared/types.ts"
import { getProviderConfig, updateProviderConfig } from "../services/providerSettings.ts"
import { getModelEntries, getProviderStatuses } from "../services/providers/status.ts"
import { asyncHandler, HttpError } from "./_util.ts"

export const providersRouter: Router = Router()

providersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await getProviderStatuses())
  }),
)

providersRouter.get(
  "/models",
  asyncHandler(async (_req, res) => {
    res.json(await getModelEntries())
  }),
)

providersRouter.get("/config", (_req, res) => {
  res.json(getProviderConfig())
})

providersRouter.put("/config", (req, res) => {
  const body = req.body as ProviderConfigPatch
  const patch: ProviderConfigPatch = {}
  for (const field of [
    "claudeBinPath",
    "codexBinPath",
    "ollamaApiKey",
    "openrouterApiKey",
    "huggingfaceApiKey",
    "cerebrasApiKey",
  ] as const) {
    if (!(field in body)) continue
    const value = body[field]
    if (value !== null && typeof value !== "string") {
      throw new HttpError(400, `${field} must be a string or null`)
    }
    patch[field] = value
  }
  res.json(updateProviderConfig(patch))
})
