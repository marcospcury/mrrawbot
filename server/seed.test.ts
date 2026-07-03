import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ROLE_IDS } from "@shared/types.ts"

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

  async function setup() {
    const dbModule = await import("./db/db.ts")
    closeDb = dbModule.closeDb
    const { seedDefaults } = await import("./seed.ts")
    const agents = await import("./db/repos/agents.ts")
    const flows = await import("./db/repos/flows.ts")
    const settings = await import("./db/repos/settings.ts")
    return { seedDefaults, ...agents, ...flows, ...settings }
  }

  /** Force the next seedDefaults() to treat the definitions as changed. */
  function invalidate(setSetting: (k: string, v: unknown) => void) {
    setSetting("seedHash", "stale")
  }

  it("seeds one builtin starter agent per role, with valid roles in every flow step", async () => {
    const { seedDefaults, listAgents, listFlows } = await setup()
    seedDefaults()

    const builtins = listAgents().filter((a) => a.isBuiltin)
    expect(builtins.map((a) => a.role).sort()).toEqual([...ROLE_IDS].sort())

    const flowList = listFlows()
    expect(flowList.length).toBeGreaterThan(0)
    for (const flow of flowList) {
      for (const s of flow.steps) expect(ROLE_IDS, `${flow.id}/${s.id}`).toContain(s.role)
    }
  })

  it("is idempotent while the definitions are unchanged", async () => {
    const { seedDefaults, listAgents } = await setup()
    seedDefaults()
    const before = listAgents()
    seedDefaults()
    expect(listAgents()).toEqual(before)
  })

  it("does not restore a user-deleted built-in flow during a refresh", async () => {
    const { seedDefaults, deleteFlow, getFlow, setSetting } = await setup()
    seedDefaults()
    expect(getFlow("flow_claude")?.isBuiltin).toBe(true)

    expect(deleteFlow("flow_claude")).toBe(true)
    expect(getFlow("flow_claude")).toBeUndefined()

    invalidate(setSetting)
    seedDefaults()

    expect(getFlow("flow_claude")).toBeUndefined()
    expect(getFlow("flow_codex")?.isBuiltin).toBe(true)
  })

  it("preserves a user-edited builtin during a refresh, while refreshing unedited ones", async () => {
    const { seedDefaults, getAgent, updateAgent, setSetting } = await setup()
    seedDefaults()

    const coder = getAgent("agent_coder")!
    await new Promise((r) => setTimeout(r, 5)) // ensure updatedAt differs from createdAt
    updateAgent("agent_coder", { ...coder, name: "My Coder", maxIterations: 99 })

    invalidate(setSetting)
    seedDefaults()

    const edited = getAgent("agent_coder")!
    expect(edited.name).toBe("My Coder")
    expect(edited.maxIterations).toBe(99)
    expect(edited.isBuiltin).toBe(true)
    // An unedited builtin was refreshed (recreated with fresh timestamps).
    expect(getAgent("agent_reviewer")?.isBuiltin).toBe(true)
  })

  it("removes unedited builtins that are no longer defined", async () => {
    const { seedDefaults, createAgent, getAgent, setSetting } = await setup()
    seedDefaults()

    // Simulate a leftover builtin from an older app version.
    createAgent(
      { name: "Zombie", provider: "claude", model: "m", effort: "high", role: "coder", systemPrompt: "", maxIterations: 5, temperature: null },
      { id: "agent_zombie", isBuiltin: true },
    )

    invalidate(setSetting)
    seedDefaults()
    expect(getAgent("agent_zombie")).toBeUndefined()
  })
})
