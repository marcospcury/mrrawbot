import { Router } from "express"
import { z } from "zod"
import { EFFORTS, type Effort } from "@shared/types.ts"
import { createFlow, deleteFlow, getFlow, listFlows, updateFlow } from "../db/repos/flows.ts"
import { asyncHandler, HttpError, parseBody, required } from "./_util.ts"

export const flowsRouter: Router = Router()

const stepSchema = z.object({
  id: z.string().default(""),
  name: z.string().default("Step"),
  provider: z.enum(["ollama", "codex", "claude"]),
  model: z.string().default(""),
  effort: z.enum(EFFORTS as [Effort, ...Effort[]]).nullable().default(null),
  fast: z.boolean().default(false),
  role: z.string().default(""),
  systemPrompt: z.string().default(""),
  maxIterations: z.number().int().min(1).max(100).default(12),
  temperature: z.number().min(0).max(2).nullable().default(null),
  mode: z.enum(["single", "plan-executor"]).default("single"),
  maxCompletionPasses: z.number().int().min(1).max(50).default(10),
  loop: z
    .object({
      to: z.string().min(1),
      approveWhen: z.string().default("APPROVE"),
      maxLoops: z.number().int().min(0).max(10).default(2),
    })
    .nullable()
    .default(null),
})

const flowSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  steps: z.array(stepSchema).min(1),
})

flowsRouter.get(
  "/",
  asyncHandler((_req, res) => {
    res.json(listFlows())
  }),
)

flowsRouter.post(
  "/",
  asyncHandler((req, res) => {
    const input = parseBody(flowSchema, req.body)
    res.status(201).json(createFlow(input))
  }),
)

flowsRouter.get(
  "/:id",
  asyncHandler((req, res) => {
    res.json(required(getFlow(req.params.id), "Flow not found"))
  }),
)

flowsRouter.patch(
  "/:id",
  asyncHandler((req, res) => {
    const input = parseBody(flowSchema, req.body)
    res.json(required(updateFlow(req.params.id, input), "Flow not found"))
  }),
)

flowsRouter.delete(
  "/:id",
  asyncHandler((req, res) => {
    required(getFlow(req.params.id), "Flow not found")
    if (!deleteFlow(req.params.id)) throw new HttpError(404, "Flow not found")
    res.status(204).end()
  }),
)
