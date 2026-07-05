export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export const MAX_ATTACHMENTS = 10

export type PromptAttachmentKind = "text" | "image" | "pdf" | "data"

export interface PromptAttachmentUploadRequest {
  filename: string
  /**
   * Base64-encoded file content.
   * Keep each upload request below the API JSON size ceiling.
   */
  dataBase64: string
  /**
   * Optional browser-reported MIME type for advisory kind inference.
   */
  mimeType?: string | null
}

export interface PromptAttachmentUploadResponse {
  absolutePath: string
  kind: PromptAttachmentKind
  storedFilename: string
  originalFilename: string
  size: number
}

export const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "txt",
  "text",
  "md",
  "markdown",
  "mdx",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "properties",
  "env",
  "gitignore",
  "gitattributes",
  "editorconfig",
  "gitmodules",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "py",
  "java",
  "kt",
  "kts",
  "gradle",
  "scala",
  "go",
  "rb",
  "rs",
  "cs",
  "csproj",
  "cshtml",
  "cpp",
  "c",
  "cc",
  "h",
  "hpp",
  "swift",
  "swiftinterface",
  "php",
  "html",
  "htm",
  "xhtml",
  "css",
  "scss",
  "sass",
  "less",
  "sql",
  "xml",
  "svg",
  "vue",
  "svelte",
  "astro",
  "sh",
  "bash",
  "zsh",
  "fish",
  "bat",
  "ps1",
  "r",
  "jl",
  "pl",
  "pm",
  "lua",
  "dart",
  "ex",
  "exs",
  "erl",
  "clj",
  "cljs",
  "f90",
  "f95",
  "fs",
  "fsx",
])

export const DATA_ATTACHMENT_EXTENSIONS = new Set(["csv", "json", "log"])

export const IMAGE_ATTACHMENT_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"])

export const PDF_ATTACHMENT_EXTENSIONS = new Set(["pdf"])

const MIME_TYPE_TO_KIND: Array<[string, PromptAttachmentKind]> = [
  ["text/plain", "text"],
  ["text/markdown", "text"],
  ["text/csv", "data"],
  ["application/json", "data"],
  ["application/log", "data"],
  ["image/png", "image"],
  ["image/jpeg", "image"],
  ["image/jpg", "image"],
  ["image/gif", "image"],
  ["image/webp", "image"],
  ["application/pdf", "pdf"],
]

const MIME_TYPE_TO_KIND_MAP = new Map(MIME_TYPE_TO_KIND)

export function getLowercaseExtension(filename: string): string {
  const normalized = filename.replace(/\\/g, "/")
  const lastSlash = normalized.lastIndexOf("/")
  const baseName = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1)

  const lastDot = baseName.lastIndexOf(".")
  if (lastDot === -1 || lastDot === baseName.length - 1) return ""

  return baseName.slice(lastDot + 1).toLowerCase()
}

export function inferPromptAttachmentKind(
  filename: string,
  mimeType?: string | null,
): PromptAttachmentKind | null {
  const extension = getLowercaseExtension(filename)

  if (extension && DATA_ATTACHMENT_EXTENSIONS.has(extension)) return "data"
  if (extension && IMAGE_ATTACHMENT_EXTENSIONS.has(extension)) return "image"
  if (extension && PDF_ATTACHMENT_EXTENSIONS.has(extension)) return "pdf"
  if (extension && TEXT_ATTACHMENT_EXTENSIONS.has(extension)) return "text"

  const normalizedMime = mimeType?.trim().toLowerCase()
  if (!normalizedMime) return null

  return MIME_TYPE_TO_KIND_MAP.get(normalizedMime) ?? null
}

export const ALLOWED_ATTACHMENT_EXTENSIONS = {
  text: TEXT_ATTACHMENT_EXTENSIONS,
  data: DATA_ATTACHMENT_EXTENSIONS,
  image: IMAGE_ATTACHMENT_EXTENSIONS,
  pdf: PDF_ATTACHMENT_EXTENSIONS,
} as const
