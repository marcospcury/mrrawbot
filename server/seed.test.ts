import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("seedDefaults", () => {
  let tempDir = ""
  let closeDb: (() => void) | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mrr-seed-"))
    vi.resetModules()
    vi.stubEnv("MRRAWBOT_DB", path.join(tempDir, "mrrawbot.db"))
  })

  afterEach(async () => {
    closeDb?.()
    closeDb = undefined
    vi.unstubAllEnvs()
    await rm(tempDir, { recursive: true, force: true })
  })

  it("does not restore a user-deleted built-in flow during default refresh", async () => {
    const dbModule = await import("./db/db.ts")
    closeDb = dbModule.closeDb
    const { seedDefaults } = await import("./seed.ts")
    const { deleteFlow, getFlow } = await import("./db/repos/flows.ts")
    const { setSetting } = await import("./db/repos/settings.ts")

    seedDefaults()
    expect(getFlow("flow_claude")?.isBuiltin).toBe(true)

    expect(deleteFlow("flow_claude")).toBe(true)
    expect(getFlow("flow_claude")).toBeUndefined()

    setSetting("seedVersion", 0)
    seedDefaults()

    expect(getFlow("flow_claude")).toBeUndefined()
    expect(getFlow("flow_codex")?.isBuiltin).toBe(true)
  })
})
