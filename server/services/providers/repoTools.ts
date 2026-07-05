import { execFile, spawn } from "node:child_process"
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { tool, type StructuredToolInterface } from "@langchain/core/tools"
import { z } from "zod"
import { safeResolve } from "../paths.ts"

const pexec = promisify(execFile)
const MAX_OUTPUT = 16_000
const DEFAULT_BASH_TIMEOUT_MS = 120_000
const MAX_BASH_TIMEOUT_MS = 600_000
const MAX_GREP_MATCHES = 40
const MAX_GREP_FILE_BYTES = 1_000_000
const SKIP_GREP_DIRS = new Set([".git", "node_modules", "dist", "release"])

function clip(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…[truncated ${s.length - MAX_OUTPUT} chars]` : s
}

function formatCommandResult(result: { exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }) {
  const parts = [`exit_code: ${result.exitCode ?? "null"}`]
  if (result.signal) parts.push(`signal: ${result.signal}`)
  if (result.stdout.trim()) parts.push(`stdout:\n${clip(result.stdout.trimEnd())}`)
  if (result.stderr.trim()) parts.push(`stderr:\n${clip(result.stderr.trimEnd())}`)
  return parts.join("\n")
}

async function grepWithNodeFallback(target: string, query: string): Promise<string> {
  const flags = /[A-Z]/.test(query) ? "" : "i"
  const matcher = new RegExp(query, flags)
  const matches: string[] = []

  const searchFile = async (filePath: string) => {
    if (matches.length >= MAX_GREP_MATCHES) return
    const info = await stat(filePath)
    if (!info.isFile() || info.size > MAX_GREP_FILE_BYTES) return

    const content = await readFile(filePath, "utf8")
    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length && matches.length < MAX_GREP_MATCHES; index += 1) {
      if (matcher.test(lines[index])) {
        const relativePath = path.relative(target, filePath) || path.basename(filePath)
        matches.push(`${relativePath}:${index + 1}:${lines[index]}`)
      }
    }
  }

  const walk = async (dir: string) => {
    if (matches.length >= MAX_GREP_MATCHES) return
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (matches.length >= MAX_GREP_MATCHES) return
      if (entry.name.startsWith(".") || SKIP_GREP_DIRS.has(entry.name)) continue

      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
      } else if (entry.isFile()) {
        await searchFile(entryPath)
      }
    }
  }

  const info = await stat(target)
  if (info.isDirectory()) {
    await walk(target)
  } else {
    await searchFile(target)
  }

  return clip(matches.join("\n") || "(no matches)")
}

function runBash(cwd: string, command: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-c", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    let stdout = ""
    let stderr = ""
    let settled = false

    const stop = (sig: NodeJS.Signals) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, sig)
          return
        } catch {
          /* fall back to killing the shell process */
        }
      }
      child.kill(sig)
    }
    const timeout = setTimeout(() => {
      stderr += `\nCommand timed out after ${timeoutMs}ms.`
      stop("SIGTERM")
    }, timeoutMs)
    const onAbort = () => {
      stderr += "\nCommand aborted."
      stop("SIGTERM")
    }

    signal?.addEventListener("abort", onAbort, { once: true })
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = clip(stdout + chunk.toString())
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = clip(stderr + chunk.toString())
    })
    child.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
      resolve(`Error: ${err.message}`)
    })
    child.on("close", (exitCode, closeSignal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
      resolve(formatCommandResult({ exitCode, signal: closeSignal, stdout, stderr }))
    })
  })
}

export function makeRepoTools(cwd: string, signal?: AbortSignal, workspaceDir?: string, uploadsDir?: string) {
  // Relative paths resolve inside the repo; absolute paths may also land in the
  // extra workspace root (e.g. the designer's app-internal design workspace) or
  // the uploads root (for attached files).
  const resolveReadPath = (p: string): string => {
    const roots = [cwd]
    if (workspaceDir) roots.push(workspaceDir)
    if (uploadsDir) roots.push(uploadsDir)

    let lastError: Error | undefined
    for (const root of roots) {
      try {
        return safeResolve(root, p)
      } catch (err) {
        lastError = err as Error
      }
    }

    throw lastError ?? new Error(`Path escapes the repository: ${p}`)
  }

  const resolveWritePath = (p: string): string => {
    try {
      return safeResolve(cwd, p)
    } catch (err) {
      if (workspaceDir) return safeResolve(workspaceDir, p)
      throw err
    }
  }

  const readFileTool = tool(
    async ({ path: p }) => {
      try {
        const abs = resolveReadPath(p)
        const info = await stat(abs)
        if (info.isDirectory()) return `Error: ${p} is a directory. Use list_dir.`
        if (info.size > 400_000) return `Error: ${p} is too large (${info.size} bytes).`
        return clip(await readFile(abs, "utf8"))
      } catch (e) {
        return `Error: ${(e as Error).message}`
      }
    },
    {
      name: "read_file",
      description: "Read a UTF-8 text file from the repository, relative to the repo root.",
      schema: z.object({ path: z.string().describe("File path relative to the repo root") }),
    },
  )

  const listDirTool = tool(
    async ({ path: p }) => {
      try {
        const abs = resolveReadPath(p || ".")
        const entries = await readdir(abs, { withFileTypes: true })
        const lines = entries
          .filter((e) => !e.name.startsWith(".git"))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
        return clip(lines.join("\n") || "(empty)")
      } catch (e) {
        return `Error: ${(e as Error).message}`
      }
    },
    {
      name: "list_dir",
      description: "List files and folders in a repository directory (relative to repo root).",
      schema: z.object({ path: z.string().default(".").describe("Directory path relative to the repo root") }),
    },
  )

  const grepTool = tool(
    async ({ query, path: p }) => {
      const target = p ? resolveReadPath(p) : cwd
      try {
        const { stdout } = await pexec(
          "rg",
          ["--line-number", "--no-heading", "--color", "never", "-S", "--max-count", "40", query, "."],
          { cwd: target, timeout: 15_000, maxBuffer: 1 << 22 },
        )
        return clip(stdout.trim() || "(no matches)")
      } catch (e) {
        const err = e as { stdout?: string; code?: number | string; message?: string }
        if (err.code === 1) return "(no matches)"
        if (err.code === "ENOENT") return await grepWithNodeFallback(target, query)
        return `Error: ${err.message ?? "search failed"}`
      }
    },
    {
      name: "grep",
      description: "Search the repository for a regex/text pattern using ripgrep. Returns file:line:match.",
      schema: z.object({
        query: z.string().describe("Pattern to search for"),
        path: z.string().optional().describe("Optional subdirectory to scope the search"),
      }),
    },
  )

  const writeFileTool = tool(
    async ({ path: p, content }) => {
      try {
        const abs = resolveWritePath(p)
        await mkdir(path.dirname(abs), { recursive: true })
        await writeFile(abs, content, "utf8")
        return `Wrote ${content.length} bytes to ${p}`
      } catch (e) {
        return `Error: ${(e as Error).message}`
      }
    },
    {
      name: "write_file",
      description: "Create or overwrite a file in the repository (relative to repo root).",
      schema: z.object({
        path: z.string().describe("File path relative to the repo root"),
        content: z.string().describe("Full file content to write"),
      }),
    },
  )

  const bashTool = tool(
    async ({ command, timeoutMs }) => {
      const boundedTimeout = Math.min(Math.max(timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS, 1_000), MAX_BASH_TIMEOUT_MS)
      return runBash(cwd, command, boundedTimeout, signal)
    },
    {
      name: "bash",
      description:
        "Run a bash command on the user's local machine from the repository root. Returns exit code, stdout, and stderr.",
      schema: z.object({
        command: z.string().min(1).describe("Bash command to run from the repository root"),
        timeoutMs: z
          .number()
          .int()
          .min(1_000)
          .max(MAX_BASH_TIMEOUT_MS)
          .default(DEFAULT_BASH_TIMEOUT_MS)
          .describe("Maximum runtime in milliseconds"),
      }),
    },
  )

  const tools: StructuredToolInterface[] = [readFileTool, listDirTool, grepTool, writeFileTool, bashTool]
  return tools
}
