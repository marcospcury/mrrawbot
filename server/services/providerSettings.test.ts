import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("provider settings", () => {
  let tempDir = ""
  let closeDb: (() => void) | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mrr-provider-settings-"))
    vi.resetModules()
    vi.stubEnv("MRRAWBOT_DB", path.join(tempDir, "mrrawbot.db"))
  })

  afterEach(async () => {
    closeDb?.()
    closeDb = undefined
    vi.unstubAllEnvs()
    await rm(tempDir, { recursive: true, force: true })
  })

  it("encrypts and decrypts values round-trip", async () => {
    const dbModule = await import("../db/db.ts")
    closeDb = dbModule.closeDb
    const { encryptSecret, decryptSecret } = await import("./secrets.ts")

    const payload = encryptSecret("sk-super-secret")
    expect(payload).not.toContain("sk-super-secret")
    expect(decryptSecret(payload)).toBe("sk-super-secret")
  })

  it("stores config encrypted, applies it to env, and clears back to defaults", async () => {
    const dbModule = await import("../db/db.ts")
    closeDb = dbModule.closeDb
    const { env } = await import("../env.ts")
    const { getSetting } = await import("../db/repos/settings.ts")
    const { getProviderConfig, loadProviderSettings, updateProviderConfig } = await import(
      "./providerSettings.ts"
    )

    const defaultClaude = env.claudeBinPath
    const defaultKey = env.ollamaApiKey

    updateProviderConfig({ claudeBinPath: "/custom/claude", ollamaApiKey: "sk-ollama-123" })
    expect(env.claudeBinPath).toBe("/custom/claude")
    expect(env.ollamaApiKey).toBe("sk-ollama-123")

    // Values in SQLite must not be plain text.
    expect(getSetting<string>("provider.claudeBinPath")).not.toContain("/custom/claude")
    expect(getSetting<string>("provider.ollamaApiKey")).not.toContain("sk-ollama-123")

    const view = getProviderConfig()
    expect(view.claudeBinPathStored).toBe(true)
    expect(view.ollamaApiKeySet).toBe(true)
    expect(view.ollamaApiKeyStored).toBe(true)

    // Simulate restart: reset env then load from the DB.
    env.claudeBinPath = defaultClaude
    env.ollamaApiKey = defaultKey
    loadProviderSettings()
    expect(env.claudeBinPath).toBe("/custom/claude")
    expect(env.ollamaApiKey).toBe("sk-ollama-123")

    // Clearing falls back to the env defaults.
    updateProviderConfig({ claudeBinPath: null, ollamaApiKey: null })
    expect(env.claudeBinPath).toBe(defaultClaude)
    expect(env.ollamaApiKey).toBe(defaultKey)
    expect(getProviderConfig().claudeBinPathStored).toBe(false)
  })
})
