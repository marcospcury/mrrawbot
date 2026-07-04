import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import type { ThreadChangeStatus } from "@shared/types.ts"
import { upsertThreadChange } from "../db/repos/changes.ts"

const pexec = promisify(execFile)

const CONTENT_LIMIT = 400 * 1024
const SCAN_LIMIT = 20_000
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "release"])

interface ChangeTrackerInput {
  threadId: string
  runId: string
  repoPath: string
}

interface CapturedContent {
  content: string | null
  missing: boolean
  truncated: boolean
  binary: boolean
  hash: string
}

interface FileStatSnapshot {
  mtimeMs: number
  size: number
}

interface GitStatusEntry {
  status: string
  changeStatus: ThreadChangeStatus
}

type GitStatusMap = Map<string, GitStatusEntry>

interface NonGitTouch {
  before: CapturedContent
}

interface ChangeTracker {
  onToolObserved(name: string, args: unknown): void
  finish(): Promise<void>
}

function logTrackerError(message: string, err: unknown) {
  console.error("[changeTracker]", message, err)
}

function hashContent(content: string | null, missing: boolean, binary: boolean): string {
  return createHash("sha256").update(`${missing ? "1" : "0"}:${binary ? "1" : "0"}:${content ?? ""}`).digest("hex")
}

function captureBuffer(buf: Buffer, missing = false): CapturedContent {
  const truncated = buf.length > CONTENT_LIMIT
  const slice = truncated ? buf.subarray(0, CONTENT_LIMIT) : buf
  const binary = slice.includes(0)
  const content = binary ? "" : slice.toString("utf8")
  return {
    content,
    missing,
    truncated,
    binary,
    hash: hashContent(content, missing, binary),
  }
}

function captureMissing(): CapturedContent {
  return {
    content: null,
    missing: true,
    truncated: false,
    binary: false,
    hash: hashContent(null, true, false),
  }
}

function captureFile(absPath: string): CapturedContent {
  try {
    const st = statSync(absPath)
    if (!st.isFile()) return captureMissing()
    return captureBuffer(readFileSync(absPath))
  } catch {
    return captureMissing()
  }
}

function safeRelativePath(repoPath: string, candidate: string): string | null {
  if (!candidate || candidate.includes("\0")) return null
  const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(repoPath, candidate)
  const rel = path.relative(repoPath, absolute)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join("/")
}

async function git(repoPath: string, args: string[], maxBuffer = 2 * 1024 * 1024): Promise<string | null> {
  try {
    const { stdout } = await pexec("git", ["-C", repoPath, ...args], { timeout: 8000, maxBuffer })
    return stdout
  } catch {
    return null
  }
}

async function isGitRepo(repoPath: string): Promise<boolean> {
  if (existsSync(path.join(repoPath, ".git"))) return true
  return (await git(repoPath, ["rev-parse", "--is-inside-work-tree"]))?.trim() === "true"
}

function parsePorcelainZ(raw: string, repoPath: string): GitStatusMap {
  const entries: GitStatusMap = new Map()
  const parts = raw.split("\0")
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue
    const status = part.slice(0, 2)
    const rawPath = part.slice(3)
    if (!rawPath) continue
    const rel = safeRelativePath(repoPath, rawPath)
    if (!rel) continue
    if (status[0] === "R" || status[1] === "R") i += 1
    entries.set(rel, { status, changeStatus: statusToChangeStatus(status) })
  }
  return entries
}

function statusToChangeStatus(status: string): ThreadChangeStatus {
  if (status === "??" || status[0] === "A" || status[1] === "A") return "added"
  if (status[0] === "D" || status[1] === "D") return "deleted"
  return "modified"
}

function gitStatusChanged(a: GitStatusEntry | undefined, b: GitStatusEntry | undefined): boolean {
  return (a?.status ?? "") !== (b?.status ?? "")
}

async function gitShow(repoPath: string, head: string, relPath: string): Promise<CapturedContent> {
  const out = await git(repoPath, ["show", `${head}:${relPath}`], CONTENT_LIMIT + 1024)
  if (out === null) return captureMissing()
  return captureBuffer(Buffer.from(out, "utf8"))
}

async function scanTree(repoPath: string): Promise<{ entries: Map<string, FileStatSnapshot>; capped: boolean }> {
  const entries = new Map<string, FileStatSnapshot>()
  let capped = false

  async function walk(dir: string): Promise<void> {
    if (entries.size >= SCAN_LIMIT) {
      capped = true
      return
    }
    let children: import("node:fs").Dirent[]
    try {
      children = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const child of children) {
      if (entries.size >= SCAN_LIMIT) {
        capped = true
        return
      }
      if (child.isDirectory() && SKIP_DIRS.has(child.name)) continue
      const abs = path.join(dir, child.name)
      const rel = safeRelativePath(repoPath, abs)
      if (!rel) continue
      if (child.isDirectory()) {
        await walk(abs)
      } else if (child.isFile()) {
        try {
          const st = statSync(abs)
          entries.set(rel, { mtimeMs: st.mtimeMs, size: st.size })
        } catch {
          /* ignore */
        }
      }
    }
  }

  await walk(repoPath)
  return { entries, capped }
}

function statsChanged(a: FileStatSnapshot | undefined, b: FileStatSnapshot | undefined): boolean {
  if (!a || !b) return a !== b
  return a.mtimeMs !== b.mtimeMs || a.size !== b.size
}

function valueAtPath(value: unknown, keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function collectStringPaths(value: unknown, out: string[] = []): string[] {
  if (!value || typeof value !== "object") return out
  if (Array.isArray(value)) {
    for (const item of value) collectStringPaths(item, out)
    return out
  }

  const obj = value as Record<string, unknown>
  for (const [key, child] of Object.entries(obj)) {
    const normalized = key.replace(/[_-]/g, "").toLowerCase()
    if (
      typeof child === "string" &&
      (normalized === "path" ||
        normalized === "filepath" ||
        normalized === "filename" ||
        normalized === "targetfile" ||
        normalized === "file")
    ) {
      out.push(child)
    } else {
      collectStringPaths(child, out)
    }
  }
  return out
}

function observedToolPaths(name: string, args: unknown, repoPath: string): string[] {
  const names = new Set(["write_file", "Write", "Edit", "MultiEdit", "NotebookEdit"])
  const candidates: unknown[] = []
  if (names.has(name)) {
    candidates.push(valueAtPath(args, ["path"]), valueAtPath(args, ["file_path"]))
  }
  if (name.toLowerCase().includes("codex")) {
    candidates.push(...collectStringPaths(args))
  }
  candidates.push(...collectStringPaths(args).filter((p) => /[\\/]/.test(p) || /\.[A-Za-z0-9]+$/.test(p)))

  const rels = new Set<string>()
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue
    const rel = safeRelativePath(repoPath, candidate)
    if (rel) rels.add(rel)
  }
  return [...rels]
}

function persistChange(input: {
  threadId: string
  runId: string
  filePath: string
  changeStatus: ThreadChangeStatus
  before: CapturedContent
  after: CapturedContent
}) {
  upsertThreadChange({
    threadId: input.threadId,
    runId: input.runId,
    filePath: input.filePath,
    changeStatus: input.changeStatus,
    beforeContent: input.before.content,
    afterContent: input.after.content,
    beforeMissing: input.before.missing,
    truncated: input.before.truncated || input.after.truncated,
    binary: input.before.binary || input.after.binary,
  })
}

function inferChangeStatus(before: CapturedContent, after: CapturedContent): ThreadChangeStatus {
  if (before.missing && !after.missing) return "added"
  if (!before.missing && after.missing) return "deleted"
  return "modified"
}

class TrackerState implements ChangeTracker {
  private mode: "git" | "non-git" | null = null
  private baseHead: string | null = null
  private startGitStatus: GitStatusMap = new Map()
  private startDirtySnapshots = new Map<string, CapturedContent>()
  private startIndex = new Map<string, FileStatSnapshot>()
  private nonGitTouches = new Map<string, NonGitTouch>()

  constructor(private readonly input: ChangeTrackerInput) {}

  onToolObserved(name: string, args: unknown): void {
    if (this.mode === "git") return
    for (const rel of observedToolPaths(name, args, this.input.repoPath)) {
      if (this.nonGitTouches.has(rel)) continue
      this.nonGitTouches.set(rel, { before: captureFile(path.join(this.input.repoPath, rel)) })
    }
  }

  async finish(): Promise<void> {
    try {
      if (this.mode === "git") await this.finishGit()
      else await this.finishNonGit()
    } catch (err) {
      logTrackerError("failed to persist file changes", err)
    }
  }

  async start(): Promise<void> {
    if (await isGitRepo(this.input.repoPath)) {
      this.mode = "git"
      this.baseHead = (await git(this.input.repoPath, ["rev-parse", "HEAD"]))?.trim() ?? null
      this.startGitStatus = parsePorcelainZ(
        (await git(this.input.repoPath, ["status", "--porcelain=v1", "-uall", "-z"])) ?? "",
        this.input.repoPath,
      )
      for (const rel of this.startGitStatus.keys()) {
        this.startDirtySnapshots.set(rel, captureFile(path.join(this.input.repoPath, rel)))
      }
      return
    }

    this.mode = "non-git"
    const startIndex = await scanTree(this.input.repoPath)
    if (startIndex.capped) console.warn("[changeTracker] non-git baseline scan capped at 20000 entries")
    this.startIndex = startIndex.entries
  }

  private async finishGit(): Promise<void> {
    const endStatus = parsePorcelainZ(
      (await git(this.input.repoPath, ["status", "--porcelain=v1", "-uall", "-z"])) ?? "",
      this.input.repoPath,
    )
    const paths = new Set([...this.startGitStatus.keys(), ...endStatus.keys()])
    for (const rel of paths) {
      const beforeDirty = this.startDirtySnapshots.get(rel)
      const before = beforeDirty ?? (this.baseHead ? await gitShow(this.input.repoPath, this.baseHead, rel) : captureMissing())
      const after = captureFile(path.join(this.input.repoPath, rel))
      const startEntry = this.startGitStatus.get(rel)
      const endEntry = endStatus.get(rel)
      if (!gitStatusChanged(startEntry, endEntry) && before.hash === after.hash) continue
      const changeStatus = endEntry?.changeStatus ?? inferChangeStatus(before, after)
      persistChange({ ...this.input, filePath: rel, changeStatus, before, after })
    }
  }

  private async finishNonGit(): Promise<void> {
    const persisted = new Set<string>()
    for (const [rel, touch] of this.nonGitTouches) {
      const after = captureFile(path.join(this.input.repoPath, rel))
      if (touch.before.hash === after.hash) continue
      persistChange({
        ...this.input,
        filePath: rel,
        changeStatus: inferChangeStatus(touch.before, after),
        before: touch.before,
        after,
      })
      persisted.add(rel)
    }

    const finishIndex = await scanTree(this.input.repoPath)
    if (finishIndex.capped) console.warn("[changeTracker] non-git scan capped at 20000 entries")
    const paths = new Set([...this.startIndex.keys(), ...finishIndex.entries.keys()])
    for (const rel of paths) {
      if (persisted.has(rel) || this.nonGitTouches.has(rel)) continue
      const startStat = this.startIndex.get(rel)
      const finishStat = finishIndex.entries.get(rel)
      if (!statsChanged(startStat, finishStat)) continue
      const before = captureMissing()
      const after = captureFile(path.join(this.input.repoPath, rel))
      persistChange({
        ...this.input,
        filePath: rel,
        changeStatus: !startStat && finishStat ? "added" : startStat && !finishStat ? "deleted" : "modified",
        before,
        after,
      })
    }
  }
}

// The baseline capture (git status + dirty-file snapshots, or a full tree walk
// for non-git repos) must complete before the run starts mutating files, but it
// uses async I/O so the server stays responsive while it runs.
export async function createChangeTracker(input: ChangeTrackerInput): Promise<ChangeTracker> {
  const tracker = new TrackerState(input)
  await tracker.start()
  return tracker
}
