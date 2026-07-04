// Serializes a build thread's attached Product Design artifacts into a prompt
// section for the agents running against the repository.
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { ArtifactInfo } from "@shared/types.ts"
import { listThreadArtifacts } from "../db/repos/artifacts.ts"
import { artifactPath } from "./artifacts.ts"

const MAX_INLINE_CHARS = 25_000

function truncate(text: string): string {
  if (text.length <= MAX_INLINE_CHARS) return text
  return `${text.slice(0, MAX_INLINE_CHARS)}\n\n[... truncated — read the file at its path above for the full content]`
}

async function renderArtifact(artifact: ArtifactInfo): Promise<string> {
  const location = artifactPath(artifact.projectId, artifact.kind, artifact.slug)
  if (artifact.kind === "prototype") {
    const handoff = await readFile(path.join(location, "HANDOFF.md"), "utf8").catch(() => "")
    const lines = [
      `## Prototype: ${artifact.title}`,
      `Read-only HTML/CSS reference at: ${location}`,
      `Browse its pages (index.html and linked pages) for layout, tokens, and interaction states. Do NOT modify it.`,
    ]
    if (handoff.trim()) {
      lines.push("", "### HANDOFF.md", truncate(handoff.trim()))
    }
    return lines.join("\n")
  }
  const content = await readFile(location, "utf8").catch(() => "")
  const label = artifact.kind === "spec" ? "Spec" : "Build prompt"
  return [`## ${label}: ${artifact.title}`, `Source file: ${location}`, "", truncate(content.trim())].join("\n")
}

/**
 * The `# Attached product-design artifacts` prompt section for a build thread,
 * or "" when the thread has no attachments.
 */
export async function buildArtifactContext(threadId: string): Promise<string> {
  const attached = listThreadArtifacts(threadId)
  if (attached.length === 0) return ""
  const sections = await Promise.all(attached.map(renderArtifact))
  return [
    "# Attached product-design artifacts",
    "The user attached these artifacts from Product Design sessions. Treat specs and build prompts as the source of truth for scope and acceptance criteria; treat prototypes as the visual/layout reference.",
    "",
    sections.join("\n\n"),
  ].join("\n")
}
