import { Router } from "express"
import { z } from "zod"
import type { PromptAttachmentUploadRequest, PromptAttachmentUploadResponse } from "@shared/attachments.ts"
import { getThread } from "../db/repos/threads.ts"
import { storePromptAttachment } from "../services/uploads.ts"
import { asyncHandler, parseBody, required } from "./_util.ts"

export const uploadsRouter: Router = Router()

const uploadSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().trim().nullable().optional(),
  dataBase64: z.string(),
})

uploadsRouter.post(
  "/threads/:id/uploads",
  asyncHandler(async (req, res) => {
    const thread = required(getThread(req.params.id), "Thread not found")
    const input = parseBody<PromptAttachmentUploadRequest>(uploadSchema, req.body)

    const stored = await storePromptAttachment({
      projectId: thread.projectId,
      threadId: thread.id,
      filename: input.filename,
      base64Data: input.dataBase64,
      mimeType: input.mimeType,
    })

    const response: PromptAttachmentUploadResponse = {
      absolutePath: stored.absolutePath,
      kind: stored.kind,
      storedFilename: stored.storedFilename,
      originalFilename: stored.originalFilename,
      size: stored.size,
    }

    res.status(201).json(response)
  }),
)
