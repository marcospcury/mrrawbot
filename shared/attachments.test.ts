import { describe, expect, it } from "vitest"

import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  DATA_ATTACHMENT_EXTENSIONS,
  getLowercaseExtension,
  IMAGE_ATTACHMENT_EXTENSIONS,
  inferPromptAttachmentKind,
  PDF_ATTACHMENT_EXTENSIONS,
  TEXT_ATTACHMENT_EXTENSIONS,
} from "./attachments"

describe("getLowercaseExtension", () => {
  it("returns the final extension in lowercase", () => {
    expect(getLowercaseExtension("Report.TXT")).toBe("txt")
    expect(getLowercaseExtension("nested/path/Archive.LOG")).toBe("log")
    expect(getLowercaseExtension("notes.Md")).toBe("md")
  })

  it("returns an empty string when no extension exists", () => {
    expect(getLowercaseExtension("README")).toBe("")
    expect(getLowercaseExtension(".env")).toBe("env")
  })
})

describe("inferPromptAttachmentKind", () => {
  it("classifies by filename extension first", () => {
    expect(inferPromptAttachmentKind("design.txt")).toBe("text")
    expect(inferPromptAttachmentKind("capture.PNG")).toBe("image")
    expect(inferPromptAttachmentKind("book.PDF")).toBe("pdf")
    expect(inferPromptAttachmentKind("errors.log")).toBe("data")
  })

  it("falls back to MIME type when extension is unknown", () => {
    expect(inferPromptAttachmentKind("unknown", "image/png")).toBe("image")
    expect(inferPromptAttachmentKind("unknown", "text/plain")).toBe("text")
    expect(inferPromptAttachmentKind("unknown", "application/pdf")).toBe("pdf")
  })

  it("returns null for unsupported attachments", () => {
    expect(inferPromptAttachmentKind("archive.exe")).toBeNull()
    expect(inferPromptAttachmentKind("archive")).toBeNull()
  })
})

describe("allowed extension sets", () => {
  it("include required kinds", () => {
    expect(ALLOWED_ATTACHMENT_EXTENSIONS.text.has("tsx")).toBe(true)
    expect(ALLOWED_ATTACHMENT_EXTENSIONS.text.has("txt")).toBe(true)
    expect(DATA_ATTACHMENT_EXTENSIONS.has("csv")).toBe(true)
    expect(DATA_ATTACHMENT_EXTENSIONS.has("json")).toBe(true)
    expect(DATA_ATTACHMENT_EXTENSIONS.has("log")).toBe(true)
    expect(IMAGE_ATTACHMENT_EXTENSIONS.has("webp")).toBe(true)
    expect(PDF_ATTACHMENT_EXTENSIONS.has("pdf")).toBe(true)
  })

  it("keeps extension categories distinct", () => {
    expect(TEXT_ATTACHMENT_EXTENSIONS.has("csv")).toBe(false)
    expect(PDF_ATTACHMENT_EXTENSIONS.has("txt")).toBe(false)
  })
})
