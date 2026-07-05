import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { MAX_ATTACHMENT_BYTES, inferPromptAttachmentKind, type PromptAttachmentKind } from "@shared/attachments.ts"
import { env } from "../env.ts"

export interface StoredPromptAttachment {
  absolutePath: string
  kind: PromptAttachmentKind
  storedFilename: string
  originalFilename: string
  size: number
}

export interface StorePromptAttachmentInput {
  projectId: string
  threadId: string
  filename: string
  base64Data: string
  mimeType?: string | null
}

export function threadUploadsDir(projectId: string, threadId: string): string {
  const dir = path.join(env.uploadsRoot, projectId, threadId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export async function storePromptAttachment(input: StorePromptAttachmentInput): Promise<StoredPromptAttachment> {
  const kind = inferPromptAttachmentKind(input.filename, input.mimeType)
  if (!kind) throw new Error("Unsupported attachment type")

  const originalFilename = input.filename
  const storedFilename = sanitizeFilename(originalFilename)
  const bytes = Buffer.from(input.base64Data, "base64")

  if (bytes.length === 0) throw new Error("Attachment is empty")
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds max size of ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`)
  }

  const dir = threadUploadsDir(input.projectId, input.threadId)
  const target = await writeWithDeconflict(dir, storedFilename, bytes)

  return {
    absolutePath: target.absolutePath,
    kind,
    storedFilename: target.storedFilename,
    originalFilename,
    size: bytes.length,
  }
}

function sanitizeFilename(filename: string): string {
  const basename = path.basename(filename.replace(/\\+/g, "/"))
  let safe = basename.replace(/[\u0000-\u001f\u007f]/g, "").trim()
  if (!safe || safe === "." || safe === "..") {
    safe = "attachment"
  }
  safe = safe.replace(/\//g, "").replace(/\\/g, "")
  return safe
}

type DeconflictedFile = {
  absolutePath: string
  storedFilename: string
}

async function writeWithDeconflict(
  dir: string,
  filename: string,
  bytes: Buffer,
): Promise<DeconflictedFile> {
  const parsed = path.parse(filename)
  const baseName = parsed.name || "attachment"
  const extension = parsed.ext

  let index = 0
  while (true) {
    const suffix = index === 0 ? "" : ` (${index})`
    const attempt = `${baseName}${suffix}${extension}`
    const absolutePath = path.join(dir, attempt)
    try {
      await writeFile(absolutePath, bytes, { flag: "wx" })
      return { absolutePath, storedFilename: attempt }
    } catch (err) {
      const writeError = err as NodeJS.ErrnoException
      if (writeError.code !== "EEXIST") throw err
      index += 1
    }
  }
}
