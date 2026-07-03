import { Router } from "express"
import { z } from "zod"
import { EFFORTS, type Effort } from "@shared/types.ts"
import { createAgent, deleteAgent, getAgent, listAgents, updateAgent } from "../db/repos/agents.ts"
import { asyncHandler, HttpError, parseBody, required } from "./_util.ts"

export const agentsRouter: Router = Router()

const agentSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(["ollama", "codex", "claude"]),
  model: z.string().min(1),
  effort: z.enum(EFFORTS as [Effort, ...Effort[]]).nullable().default(null),
  role: z.string().default(""),
  systemPrompt: z.string().default(""),
  maxIterations: z.number().int().min(1).max(100).default(12),
  temperature: z.number().min(0).max(2).nullable().default(null),
})

agentsRouter.get(
  "/",
  asyncHandler((_req, res) => {
    res.json(listAgents())
  }),
)

agentsRouter.post(
  "/",
  asyncHandler((req, res) => {
    const input = parseBody(agentSchema, req.body)
    res.status(201).json(createAgent(input))
  }),
)

agentsRouter.get(
  "/:id",
  asyncHandler((req, res) => {
    res.json(required(getAgent(req.params.id), "Agent not found"))
  }),
)

agentsRouter.patch(
  "/:id",
  asyncHandler((req, res) => {
    const input = parseBody(agentSchema, req.body)
    res.json(required(updateAgent(req.params.id, input), "Agent not found"))
  }),
)

agentsRouter.delete(
  "/:id",
  asyncHandler((req, res) => {
    const agent = required(getAgent(req.params.id), "Agent not found")
    if (agent.isBuiltin) throw new HttpError(400, "Built-in agents cannot be deleted")
    if (!deleteAgent(req.params.id)) throw new HttpError(404, "Agent not found")
    res.status(204).end()
  }),
)
