import path from "node:path"

/** Resolve a user-supplied path within a root, rejecting traversal escapes. */
export function safeResolve(root: string, p: string): string {
  const resolved = path.resolve(root, p || ".")
  const rel = path.relative(root, resolved)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the repository: ${p}`)
  }
  return resolved
}
