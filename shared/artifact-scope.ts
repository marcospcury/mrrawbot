import type { ArtifactInfo } from "./types.ts"

/**
 * Folder scoping for artifacts, derived from the producing thread's current
 * folder: an artifact made by a thread that sits in a sidebar folder belongs
 * to that folder and is visible only when working inside it. Artifacts with
 * no producing thread (absorbed from disk), or whose thread is unfoldered or
 * gone, are repo-wide and visible everywhere.
 */
export function scopeArtifacts(
  artifacts: ArtifactInfo[],
  threads: Array<{ id: string; folderId: string | null }>,
  activeFolderId: string | null,
): ArtifactInfo[] {
  const folderByThread = new Map(threads.map((t) => [t.id, t.folderId]))
  return artifacts.filter((a) => {
    const folderId = (a.threadId && folderByThread.get(a.threadId)) || null
    return folderId === null || folderId === activeFolderId
  })
}
