import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

// No .env file: the app is configured from the UI (Settings → Providers, stored
// encrypted in SQLite). Plain MRRAWBOT_* system environment variables remain as
// optional overrides for the non-provider knobs below (port, db path, repo scan).

// Local-first app: never allow CopilotKit's default anonymous telemetry.
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
  /**
   * App-internal store for Product Design artifacts: prototypes at
   * `<artifactsRoot>/<projectId>/<slug>/`, specs and prompts as markdown under
   * `<artifactsRoot>/<projectId>/{specs,prompts}/`. Lives next to the SQLite
   * database — never inside a user repository. The on-disk folder is still
   * named `designs` so existing installs keep their prototypes.
   * Override with MRRAWBOT_DESIGNS_DIR.
   */
  artifactsRoot: string
  /**
   * App-internal store for user-uploaded prompt attachments. Files are staged
   * under `<uploadsRoot>/<projectId>/<threadId>/`, outside any project repo, and
   * shared by the UI and all provider runners.
   * Override with MRRAWBOT_UPLOADS_DIR.
   */
  uploadsRoot: string
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

  openrouterBaseUrl: string
  openrouterApiKey: string | null
  openrouterDefaultModel: string

  huggingfaceBaseUrl: string
  huggingfaceApiKey: string | null
  huggingfaceDefaultModel: string

  cerebrasBaseUrl: string
  cerebrasApiKey: string | null
  cerebrasDefaultModel: string

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

const dbPath = process.env.MRRAWBOT_DB ?? defaultDbPath()

export const env: Env = {
  port: Number(process.env.MRRAWBOT_PORT ?? 4000),
  dbPath,
  artifactsRoot: process.env.MRRAWBOT_DESIGNS_DIR ?? path.join(path.dirname(dbPath), "designs"),
  uploadsRoot: process.env.MRRAWBOT_UPLOADS_DIR ?? path.join(path.dirname(dbPath), "uploads"),
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

  openrouterBaseUrl: "https://openrouter.ai/api/v1",
  openrouterApiKey:
    process.env.MRRAWBOT_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? null,
  openrouterDefaultModel: process.env.MRRAWBOT_OPENROUTER_MODEL ?? "qwen/qwen3-coder",

  huggingfaceBaseUrl: "https://router.huggingface.co/v1",
  huggingfaceApiKey: process.env.MRRAWBOT_HF_TOKEN ?? process.env.HF_TOKEN ?? null,
  huggingfaceDefaultModel:
    process.env.MRRAWBOT_HF_MODEL ?? "Qwen/Qwen3-Coder-480B-A35B-Instruct",

  cerebrasBaseUrl: "https://api.cerebras.ai/v1",
  cerebrasApiKey:
    process.env.MRRAWBOT_CEREBRAS_API_KEY ?? process.env.CEREBRAS_API_KEY ?? null,
  cerebrasDefaultModel: process.env.MRRAWBOT_CEREBRAS_MODEL ?? "qwen-3-coder-480b",

  isProduction: process.env.NODE_ENV === "production",
}

export const COPILOT_RUNTIME_PATH = "/api/copilotkit"
