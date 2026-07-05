import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MAX_ATTACHMENT_BYTES } from "@shared/attachments.ts"

import type { StorePromptAttachmentInput, StoredPromptAttachment } from "./uploads.ts"

describe("threadUploadsDir", () => {
  let tempDir = ""

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mrr-uploads-dir-"))
    vi.resetModules()
    vi.stubEnv("MRRAWBOT_DB", path.join(tempDir, "mrrawbot.db"))
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(tempDir, { recursive: true, force: true })
  })

  it("creates and returns the project/thread upload directory", async () => {
    const { threadUploadsDir } = await import("./uploads.ts")
    const dir = threadUploadsDir("project-id", "thread-id")

    expect(dir).toBe(path.join(tempDir, "uploads", "project-id", "thread-id"))
  })
})

describe("storePromptAttachment", () => {
  let fixtureDir = ""
  let storePromptAttachment: (input: StorePromptAttachmentInput) => Promise<StoredPromptAttachment>

  beforeEach(async () => {
    fixtureDir = await mkdtemp(path.join(tmpdir(), "mrr-uploads-service-"))
    vi.resetModules()
    vi.stubEnv("MRRAWBOT_DB", path.join(fixtureDir, "mrrawbot.db"))
    const service = await import("./uploads.ts")
    storePromptAttachment = service.storePromptAttachment
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(fixtureDir, { recursive: true, force: true })
  })

  it("writes a valid attachment and returns storage details", async () => {
    const attachment = await storePromptAttachment({
      projectId: "project-1",
      threadId: "thread-1",
      filename: "note.txt",
      base64Data: Buffer.from("hello world", "utf8").toString("base64"),
      mimeType: "text/plain",
    })

    expect(attachment).toEqual({
      absolutePath: path.join(fixtureDir, "uploads", "project-1", "thread-1", "note.txt"),
      kind: "text",
      storedFilename: "note.txt",
      originalFilename: "note.txt",
      size: 11,
    })
    expect(await readFile(attachment.absolutePath, "utf8")).toBe("hello world")
  })

  it("de-collides duplicates by adding a numeric suffix before the extension", async () => {
    const input = {
      projectId: "project-2",
      threadId: "thread-1",
      filename: "notes.txt",
      base64Data: Buffer.from("line", "utf8").toString("base64"),
    }
    const first = await storePromptAttachment(input)
    const second = await storePromptAttachment(input)

    expect(first.storedFilename).toBe("notes.txt")
    expect(second.storedFilename).toBe("notes (1).txt")
    expect(second.absolutePath).toBe(path.join(fixtureDir, "uploads", "project-2", "thread-1", "notes (1).txt"))
  })

  it("sanitizes traversal-prone filenames and keeps stored names safe", async () => {
    const attachment = await storePromptAttachment({
      projectId: "project-3",
      threadId: "thread-1",
      filename: "../..\\secret.txt",
      mimeType: "text/plain",
      base64Data: Buffer.from("safe", "utf8").toString("base64"),
    })

    expect(attachment.storedFilename).toBe("secret.txt")
    expect(attachment.storedFilename).not.toContain("/")
    expect(attachment.storedFilename).not.toContain("\\")
    expect(attachment.absolutePath).toBe(
      path.join(fixtureDir, "uploads", "project-3", "thread-1", "secret.txt"),
    )
  })

  it("renames empty, traversal-only names to a safe fallback", async () => {
    const attachment = await storePromptAttachment({
      projectId: "project-4",
      threadId: "thread-1",
      filename: "../..",
      mimeType: "text/plain",
      base64Data: Buffer.from("fallback", "utf8").toString("base64"),
    })

    expect(attachment.storedFilename).toBe("attachment")
    expect(attachment.absolutePath).toBe(
      path.join(fixtureDir, "uploads", "project-4", "thread-1", "attachment"),
    )
  })

  it("rejects unsupported attachment types", async () => {
    await expect(
      storePromptAttachment({
        projectId: "project-5",
        threadId: "thread-1",
        filename: "payload.exe",
        base64Data: Buffer.from("bad", "utf8").toString("base64"),
      }),
    ).rejects.toThrow(/Unsupported attachment/)
  })

  it("rejects zero-byte attachments", async () => {
    await expect(
      storePromptAttachment({
        projectId: "project-6",
        threadId: "thread-1",
        filename: "empty.txt",
        base64Data: "",
      }),
    ).rejects.toThrow(/empty/i)
  })

  it("rejects attachments over 10 MB", async () => {
    await expect(
      storePromptAttachment({
        projectId: "project-7",
        threadId: "thread-1",
        filename: "large.txt",
        base64Data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString("base64"),
      }),
    ).rejects.toThrow(/max size/i)
  })
})
