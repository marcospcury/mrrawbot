import { config as loadDotenv } from "dotenv"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Load .env and MERGE with the existing system environment.
// dotenv does NOT override variables already present in process.env, so real
// system/shell variables win and .env only fills the gaps — exactly the
// "merge with the system existing variables" behavior requested.
loadDotenv()

// Local-only app: never allow CopilotKit's default anonymous telemetry.
process.env.COPILOTKIT_TELEMETRY_DISABLED = "true"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT_DIR = path.resolve(__dirname, "..")

function home(...p: string[]) {
  return path.join(homedir(), ...p)
}

function parseRoots(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[:,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("~") ? path.join(homedir(), s.slice(1)) : s))
}

/**
 * Candidate roots scanned for git repositories. Defaults to the entire home
 * directory (depth-limited, with heavy/system folders skipped) so repos anywhere
 * under ~ are discovered. Override with MRRAWBOT_REPO_ROOTS for a narrower scan.
 */
const DEFAULT_REPO_ROOTS = [homedir()].filter((p) => existsSync(p))

export interface Env {
  port: number
  dbPath: string
  repoRoots: string[]
  repoScanDepth: number

  claudeBinPath: string
  claudeDefaultModel: string

  codexBinPath: string
  /**
   * Where the user's real Codex auth lives (default ~/.codex). Only auth.json
   * is read from here; Codex itself always runs in an app-managed isolated
   * CODEX_HOME so it never inherits the user's config, skills, or hooks.
   */
  codexHome: string | null
  codexDefaultModel: string

  ollamaBaseUrl: string
  ollamaApiKey: string | null
  ollamaDefaultModel: string

  isProduction: boolean
}

function firstExisting(candidates: string[], fallback: string): string {
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return fallback
}

/** Resolve a binary from PATH so defaults work regardless of how it was installed. */
function findOnPath(name: string): string {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return ""
}

function binPath(name: string, override: string | undefined, fallback: string): string {
  return firstExisting(
    [
      override ?? "",
      findOnPath(name),
      home(".local", "bin", name),
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
    ],
    fallback,
  )
}

/**
 * A stable, build-independent home for the SQLite database — outside the repo
 * AND outside the packaged .app bundle — so threads/data persist across rebuilds
 * and are shared by `npm run dev`, `npm run app`, and the packaged Mr Rawbot.app.
 * Override with MRRAWBOT_DB.
 */
function defaultDbPath(): string {
  const dir =
    process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support", "Mr Rawbot")
      : path.join(homedir(), ".mrrawbot")
  return path.join(dir, "mrrawbot.db")
}

export const env: Env = {
  port: Number(process.env.MRRAWBOT_PORT ?? 4000),
  dbPath: process.env.MRRAWBOT_DB ?? defaultDbPath(),
  repoRoots:
    parseRoots(process.env.MRRAWBOT_REPO_ROOTS).filter((p) => existsSync(p)).length > 0
      ? parseRoots(process.env.MRRAWBOT_REPO_ROOTS).filter((p) => existsSync(p))
      : DEFAULT_REPO_ROOTS,
  repoScanDepth: Number(process.env.MRRAWBOT_REPO_SCAN_DEPTH ?? 6),

  claudeBinPath: binPath("claude", process.env.MRRAWBOT_CLAUDE_BIN, home(".local", "bin", "claude")),
  claudeDefaultModel: process.env.MRRAWBOT_CLAUDE_MODEL ?? "claude-opus-4-8",

  codexBinPath: binPath("codex", process.env.MRRAWBOT_CODEX_BIN, "codex"),
  codexHome: process.env.MRRAWBOT_CODEX_HOME ?? process.env.CODEX_HOME ?? null,
  codexDefaultModel: process.env.MRRAWBOT_CODEX_MODEL ?? "gpt-5.5",

  ollamaBaseUrl: "https://ollama.com",
  ollamaApiKey:
    process.env.MRRAWBOT_OLLAMA_API_KEY ?? process.env.OLLAMA_API_KEY ?? null,
  ollamaDefaultModel: process.env.MRRAWBOT_OLLAMA_MODEL ?? "qwen3-coder:480b-cloud",

  isProduction: process.env.NODE_ENV === "production",
}

export const COPILOT_RUNTIME_PATH = "/api/copilotkit"
