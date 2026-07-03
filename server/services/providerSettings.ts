import type { ProviderConfig, ProviderConfigPatch } from "@shared/types.ts"
import { deleteSetting, getSetting, setSetting } from "../db/repos/settings.ts"
import { env } from "../env.ts"
import { decryptSecret, encryptSecret } from "./secrets.ts"

/**
 * Provider config (CLI paths + Ollama Cloud API key) lives in the SQLite
 * settings table, encrypted at rest, so the app is configurable from the UI
 * without a .env file. Values stored here override the env/auto-detected
 * defaults; clearing a value falls back to those defaults.
 */

const KEYS = {
  claudeBinPath: "provider.claudeBinPath",
  codexBinPath: "provider.codexBinPath",
  ollamaApiKey: "provider.ollamaApiKey",
} as const

type Field = keyof typeof KEYS

// Defaults as resolved by env.ts (env vars + auto-detection), captured before
// any DB overrides are applied on top.
const defaults = {
  claudeBinPath: env.claudeBinPath,
  codexBinPath: env.codexBinPath,
  ollamaApiKey: env.ollamaApiKey,
}

function readStored(field: Field): string | null {
  const payload = getSetting<string>(KEYS[field])
  if (!payload) return null
  try {
    return decryptSecret(payload)
  } catch {
    // Key file rotated/deleted — treat as unset rather than crashing.
    return null
  }
}

/** Apply DB-stored provider config on top of env defaults. Call once at startup. */
export function loadProviderSettings(): void {
  for (const field of Object.keys(KEYS) as Field[]) {
    const stored = readStored(field)
    if (stored) setEnvField(field, stored)
  }
}

function setEnvField(field: Field, value: string | null): void {
  ;(env as Record<Field, string | null>)[field] = value
}

export function getProviderConfig(): ProviderConfig {
  return {
    claudeBinPath: env.claudeBinPath,
    codexBinPath: env.codexBinPath,
    claudeBinPathStored: readStored("claudeBinPath") !== null,
    codexBinPathStored: readStored("codexBinPath") !== null,
    ollamaApiKeySet: !!env.ollamaApiKey,
    ollamaApiKeyStored: readStored("ollamaApiKey") !== null,
  }
}

/** Set (encrypt + store) or clear (fall back to defaults) provider config values. */
export function updateProviderConfig(patch: ProviderConfigPatch): ProviderConfig {
  for (const field of Object.keys(KEYS) as Field[]) {
    if (!(field in patch)) continue
    const value = patch[field]?.trim() || null
    if (value) {
      setSetting(KEYS[field], encryptSecret(value))
      setEnvField(field, value)
    } else {
      deleteSetting(KEYS[field])
      setEnvField(field, defaults[field])
    }
  }
  return getProviderConfig()
}
