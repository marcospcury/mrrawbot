import crypto from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { env } from "../env.ts"

/**
 * Basic at-rest encryption for values stored in the settings table (provider
 * paths, API keys). AES-256-GCM with a random key kept next to the database
 * (0600). This keeps secrets out of plain-text SQLite dumps — it is not meant
 * to defend against an attacker with full access to the local machine.
 */

let cachedKey: Buffer | null = null

function keyFilePath(): string {
  return path.join(path.dirname(env.dbPath), "secret.key")
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const file = keyFilePath()
  if (existsSync(file)) {
    cachedKey = Buffer.from(readFileSync(file, "utf8").trim(), "hex")
  } else {
    const key = crypto.randomBytes(32)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, key.toString("hex"), { mode: 0o600 })
    cachedKey = key
  }
  if (cachedKey.length !== 32) throw new Error(`Invalid secret key at ${file} (expected 32 bytes)`)
  return cachedKey
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":")
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(":")
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognized secret payload")
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"))
  decipher.setAuthTag(Buffer.from(tag, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")
}
