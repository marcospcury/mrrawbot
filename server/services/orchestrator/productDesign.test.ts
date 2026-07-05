import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProductDesignPersona, Provider, SessionConfig } from "@shared/types.ts"
import type { ProviderRunner } from "../providers/types.ts"

const mocks = vi.hoisted(() => ({
  listArtifacts: vi.fn(() => []),
}))

vi.mock("../../db/repos/artifacts.ts", () => ({
  listArtifacts: mocks.listArtifacts,
}))

function baseSession(): SessionConfig {
  return {
    provider: "claude",
    model: "",
    effort: null,
    fast: false,
    role: "",
  }
}

function basePersona(): ProductDesignPersona {
  return "specialist"
}

describe("runProductDesignTurn", () => {
  beforeEach(() => {
    mocks.listArtifacts.mockReset()
  })

  it("passes uploadsDir to the selected provider runner", async () => {
    const runners: Partial<Record<Provider, ProviderRunner>> = {
      claude: async (input) => {
        expect(input.uploadsDir).toBe("/uploads/p1/thread-1")
        return { text: "specialist says ok", usage: null }
      },
    }

    const { runProductDesignTurn } = await import("./productDesign.ts")
    const reply = await runProductDesignTurn({
      projectId: "project-1",
      repoPath: "/repo",
      repoName: "repo",
      uploadsDir: "/uploads/p1/thread-1",
      artifactsWorkspace: "/artifacts/project-1",
      session: baseSession(),
      persona: basePersona(),
      task: "Draft a new plan",
      history: "User: old context",
      emit: () => {},
      signal: new AbortController().signal,
      runners,
    })

    expect(reply).toBe("specialist says ok")
  })
})

