import { describe, expect, it } from "vitest"

import { scopeArtifacts } from "./artifact-scope"
import type { ArtifactInfo } from "./types"

function artifact(id: string, threadId: string | null): ArtifactInfo {
  return {
    id,
    projectId: "prj",
    threadId,
    runId: null,
    kind: "spec",
    slug: id,
    title: id,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }
}

const threads = [
  { id: "thr-a", folderId: "fld-1" },
  { id: "thr-b", folderId: null },
]

const fromFolderedThread = artifact("art-1", "thr-a")
const fromLooseThread = artifact("art-2", "thr-b")
const fromNoThread = artifact("art-3", null)
const fromDeletedThread = artifact("art-4", "thr-gone")
const all = [fromFolderedThread, fromLooseThread, fromNoThread, fromDeletedThread]

describe("scopeArtifacts", () => {
  it("shows folder artifacts only inside their folder, plus repo-wide ones", () => {
    expect(scopeArtifacts(all, threads, "fld-1")).toEqual(all)
  })

  it("hides foldered artifacts outside any folder", () => {
    expect(scopeArtifacts(all, threads, null)).toEqual([fromLooseThread, fromNoThread, fromDeletedThread])
  })

  it("hides foldered artifacts inside a different folder", () => {
    expect(scopeArtifacts(all, threads, "fld-2")).toEqual([fromLooseThread, fromNoThread, fromDeletedThread])
  })
})
