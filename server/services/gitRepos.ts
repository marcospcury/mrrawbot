import { execFile } from "node:child_process"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import type { GitRepo } from "@shared/types.ts"
import { env } from "../env.ts"

const pexec = promisify(execFile)

const SKIP_DIRS = new Set([
  // build / dependency / cache dirs
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  "Caches",
  "vendor",
  "venv",
  ".venv",
  "__pycache__",
  "target",
  ".gradle",
  "Pods",
  "DerivedData",
  "pkg",
  // virtual / VM / container filesystems — scanning these is catastrophic
  // (they expose entire guest filesystems through a FUSE/virtiofs mount).
  "OrbStack",
  ".orbstack",
  "Containers",
  "Parallels",
  "VirtualBox VMs",
  ".docker",
  ".colima",
  ".lima",
  // heavy / system / media / cloud home folders (rarely contain repos)
  "Library",
  "Applications",
  "Music",
  "Movies",
  "Pictures",
  "Plex",
  "OneDrive",
  "Postman",
  "Postman Agent",
  "Public",
  ".Trash",
])

async function gitField(repoPath: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await pexec("git", ["-C", repoPath, ...args], { timeout: 8000, maxBuffer: 1 << 20 })
    return stdout.trim() || null
  } catch {
    return null
  }
}

export function parseGitHub(remoteUrl: string | null): { owner: string; repo: string } | null {
  if (!remoteUrl) return null
  // git@github.com:owner/repo.git | https://github.com/owner/repo(.git) | ssh://git@github.com/owner/repo.git
  const m = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/i)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

async function describeRepo(repoPath: string): Promise<GitRepo> {
  const [remoteUrl, branch, lastCommitAt, status] = await Promise.all([
    gitField(repoPath, ["config", "--get", "remote.origin.url"]),
    gitField(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
    gitField(repoPath, ["log", "-1", "--format=%cI"]),
    gitField(repoPath, ["status", "--porcelain"]),
  ])
  const gh = parseGitHub(remoteUrl)
  return {
    path: repoPath,
    name: path.basename(repoPath),
    remoteUrl,
    isGitHub: gh !== null,
    githubOwner: gh?.owner ?? null,
    githubRepo: gh?.repo ?? null,
    branch,
    dirty: status !== null && status.length > 0,
    lastCommitAt,
  }
}

export async function findGitDirs(root: string, maxDepth: number): Promise<string[]> {
  const found: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isDirectory() && e.name === ".git")) {
      found.push(dir)
      return // do not descend into nested repos' working trees beyond this point
    }
    if (depth >= maxDepth) return
    const subdirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name),
    )
    await Promise.all(subdirs.map((e) => walk(path.join(dir, e.name), depth + 1)))
  }
  await walk(root, 0)
  return found
}

// Note: findGitDirs stops descending once it finds a `.git` at a directory, so a
// monorepo that *contains* nested sub-repos will only surface the outer one. Most
// dev layouts (siblings under ~/source) are flat, which is what we optimize for.

// describeRepo spawns 4 git processes per repo; describing every discovered
// repo at once forks 4×N processes in one burst. Cap the repos in flight.
const DESCRIBE_CONCURRENCY = 8

async function describeAll(paths: string[]): Promise<GitRepo[]> {
  const results: GitRepo[] = new Array(paths.length)
  let next = 0
  async function worker() {
    while (next < paths.length) {
      const i = next++
      results[i] = await describeRepo(paths[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(DESCRIBE_CONCURRENCY, paths.length) }, worker))
  return results
}

let cache: { at: number; repos: GitRepo[] } | null = null
const TTL_MS = 20_000
let inflight: Promise<GitRepo[]> | null = null

export async function scanRepos(force = false): Promise<GitRepo[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.repos
  if (inflight) return inflight
  inflight = (async () => {
    const dirSets = await Promise.all(env.repoRoots.map((r) => findGitDirs(r, env.repoScanDepth)))
    const unique = Array.from(new Set(dirSets.flat()))
    const repos = await describeAll(unique)
    repos.sort((a, b) => {
      if (a.isGitHub !== b.isGitHub) return a.isGitHub ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    cache = { at: Date.now(), repos }
    return repos
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}
