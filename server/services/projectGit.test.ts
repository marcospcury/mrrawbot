import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CommandRunner } from "./projectGit.ts"
import { makeProjectGitService, parseGitHubRemote } from "./projectGit.ts"

const pexec = promisify(execFile)

function project(repoPath: string) {
  return { repoPath }
}

describe("parseGitHubRemote", () => {
  it("supports GitHub.com SSH, HTTPS, and ssh URLs", () => {
    expect(parseGitHubRemote("git@github.com:acme/mrrawbot.git")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "mrrawbot",
    })
    expect(parseGitHubRemote("https://github.com/acme/mrrawbot")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "mrrawbot",
    })
    expect(parseGitHubRemote("ssh://git@github.com/acme/mrrawbot.git")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "mrrawbot",
    })
  })

  it("rejects non-GitHub.com remotes", () => {
    expect(parseGitHubRemote("git@gitlab.com:acme/mrrawbot.git")).toBeNull()
    expect(parseGitHubRemote(null)).toBeNull()
  })
})

describe("project Git status", () => {
  let tempDir = ""

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mrr-project-git-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("marks a plain folder as non-Git", async () => {
    const service = makeProjectGitService()
    const status = await service.getStatus(project(tempDir))

    expect(status.isGit).toBe(false)
    expect(status.branch).toBeNull()
    expect(status.pullRequest).toBeNull()
  })

  it("reports branch state for a non-GitHub Git remote without PR controls", async () => {
    const repoPath = path.join(tempDir, "repo")
    await initRepo(repoPath)
    await pexec("git", ["remote", "add", "origin", "git@gitlab.com:acme/repo.git"], { cwd: repoPath })

    const service = makeProjectGitService()
    const status = await service.getStatus(project(repoPath))

    expect(status).toEqual(expect.objectContaining({ isGit: true, branch: "main", defaultBranch: "main" }))
    expect(status.remote).toEqual(
      expect.objectContaining({ isGitHub: false, url: "git@gitlab.com:acme/repo.git" }),
    )
    expect(status.pullRequest).toBeNull()
    expect(status.github).toBeNull()
  })

  it("rejects invalid and existing branch names", async () => {
    const repoPath = path.join(tempDir, "repo")
    await initRepo(repoPath)
    const service = makeProjectGitService()

    await expect(service.createBranch(project(repoPath), "bad branch")).rejects.toThrow("Invalid branch name")
    await expect(service.createBranch(project(repoPath), "main")).rejects.toThrow("Branch already exists")
  })

  it("creates branches from origin/<default> without tracking it", async () => {
    const repoPath = path.join(tempDir, "repo")
    const originPath = path.join(tempDir, "origin.git")
    await initRepo(repoPath)
    await pexec("git", ["init", "--bare", originPath])
    await pexec("git", ["remote", "add", "origin", originPath], { cwd: repoPath })
    await pexec("git", ["push", "-u", "origin", "main"], { cwd: repoPath })

    const service = makeProjectGitService()
    const status = await service.createBranch(project(repoPath), "feat/from-origin")

    expect(status.branch).toBe("feat/from-origin")
    // Tracking origin/main would make a later plain `git push` refuse to push.
    await expect(
      pexec("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { cwd: repoPath }),
    ).rejects.toThrow()
    expect(status.hasUpstream).toBe(false)
  })

  it("lists local branch statuses with current and default flags", async () => {
    const repoPath = path.join(tempDir, "repo")
    await initRepo(repoPath)
    await pexec("git", ["branch", "feat/topic"], { cwd: repoPath })

    const service = makeProjectGitService()
    const branches = await service.listBranchStatuses(project(repoPath))

    expect(branches).toContainEqual(
      expect.objectContaining({ name: "main", isCurrent: true, isDefault: true, exists: true, pullRequest: null }),
    )
    expect(branches).toContainEqual(
      expect.objectContaining({ name: "feat/topic", isCurrent: false, isDefault: false, exists: true }),
    )
  })
})

describe("project GitHub integration", () => {
  it("finds an open PR by the current branch head", async () => {
    const client = fakeGitHubClient()
    client.paginate.mockResolvedValueOnce([fakePullRequest()])
    const service = makeProjectGitService({
      runCommand: fakeGitRunner(),
      createGitHubClient: vi.fn(() => client.value),
    })

    const status = await service.getStatus(project("/repo"))

    expect(status.pullRequest).toEqual(expect.objectContaining({ number: 42, headSha: "abc123" }))
    expect(status.github).toEqual({ authenticated: true, error: null })
  })

  it("records auth/API failures in status without hiding local Git state", async () => {
    const client = fakeGitHubClient()
    client.paginate.mockRejectedValueOnce(Object.assign(new Error("bad credentials"), { status: 401 }))
    const service = makeProjectGitService({
      runCommand: fakeGitRunner(),
      createGitHubClient: vi.fn(() => client.value),
    })

    const status = await service.getStatus(project("/repo"))

    expect(status.isGit).toBe(true)
    expect(status.branch).toBe("feat/git-header")
    expect(status.github).toEqual({ authenticated: true, error: "GitHub authentication failed" })
  })

  it("pushes the branch before creating a non-draft PR", async () => {
    const events: string[] = []
    const client = fakeGitHubClient(events)
    client.paginate.mockResolvedValue([])
    client.pullsCreate.mockImplementation(async () => {
      events.push("create-pr")
      return { data: fakePullRequest({ number: 7, title: "Git header", draft: false }) }
    })
    client.pullsGet.mockResolvedValue({ data: detailedPullRequest({ number: 7 }) })
    client.reposGet.mockResolvedValue({ data: { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: false } })

    const service = makeProjectGitService({
      runCommand: fakeGitRunner(events),
      createGitHubClient: vi.fn(() => client.value),
    })

    const details = await service.createPullRequest(project("/repo"), { title: "Git header" })

    expect(details.pullRequest).toEqual(expect.objectContaining({ number: 7, draft: false }))
    expect(events.indexOf("push")).toBeGreaterThanOrEqual(0)
    expect(events.indexOf("push")).toBeLessThan(events.indexOf("create-pr"))
    expect(client.pullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Git header", draft: false, head: "feat/git-header", base: "main" }),
    )
  })

  it("merges with the selected method and expected head SHA", async () => {
    const client = fakeGitHubClient()
    client.paginate.mockResolvedValue([])
    client.pullsGet.mockResolvedValue({ data: detailedPullRequest({ number: 9, headSha: "abc123" }) })
    client.reposGet.mockResolvedValue({ data: { allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: true } })
    client.pullsMerge.mockResolvedValue({ data: { merged: true, message: "Pull Request successfully merged", sha: "merge123" } })
    const service = makeProjectGitService({
      runCommand: fakeGitRunner(),
      createGitHubClient: vi.fn(() => client.value),
    })

    const result = await service.mergePullRequest(project("/repo"), 9, {
      confirm: true,
      method: "squash",
      expectedHeadSha: "abc123",
    })

    expect(result).toEqual({ merged: true, message: "Pull Request successfully merged", sha: "merge123" })
    expect(client.pullsMerge).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 9, merge_method: "squash", sha: "abc123" }),
    )
  })

  it("keeps a merged PR visible for branch cleanup", async () => {
    const client = fakeGitHubClient()
    client.paginate.mockResolvedValueOnce([fakePullRequest({ state: "closed", mergedAt: "2026-07-03T10:00:00Z" })])
    const service = makeProjectGitService({
      runCommand: fakeGitRunner(),
      createGitHubClient: vi.fn(() => client.value),
    })

    const status = await service.getStatus(project("/repo"))

    expect(status.pullRequest).toEqual(expect.objectContaining({ number: 42, merged: true, mergedAt: "2026-07-03T10:00:00Z" }))
  })
})

describe("project Git actions", () => {
  const nonGitHubRemote = "git@gitlab.com:acme/repo.git"

  it("commits all dirty changes on the current branch", async () => {
    const events: string[] = []
    const service = makeProjectGitService({
      runCommand: fakeGitRunner(events, { dirty: true, ahead: 0, remoteUrl: nonGitHubRemote }),
    })

    const status = await service.commitChanges(project("/repo"), { message: "Save work" })

    expect(events).toContain("add")
    expect(events).toContain("commit:Save work")
    expect(status.dirty).toBe(false)
    expect(status.ahead).toBe(1)
  })

  it("creates a new branch before committing when requested", async () => {
    const events: string[] = []
    const service = makeProjectGitService({
      runCommand: fakeGitRunner(events, {
        branch: "main",
        dirty: true,
        ahead: 0,
        remoteBranches: ["main"],
        remoteUrl: nonGitHubRemote,
      }),
    })

    const status = await service.commitChanges(project("/repo"), {
      message: "Save work",
      branchName: "feat/save-work",
    })

    expect(events).toContain("checkout-new:feat/save-work")
    expect(events).toContain("commit:Save work")
    expect(status.branch).toBe("feat/save-work")
    expect(status.published).toBe(false)
    expect(status.canPush).toBe(true)
  })

  it("pushes with upstream when the branch is unpublished", async () => {
    const events: string[] = []
    const service = makeProjectGitService({
      runCommand: fakeGitRunner(events, {
        hasUpstream: false,
        remoteBranches: ["main"],
        ahead: 1,
        remoteUrl: nonGitHubRemote,
      }),
    })

    const status = await service.pushCurrentBranch(project("/repo"))

    expect(events).toContain("push-upstream")
    expect(status.published).toBe(true)
    expect(status.ahead).toBe(0)
  })

  it("pushes the existing upstream when one is configured", async () => {
    const events: string[] = []
    const service = makeProjectGitService({ runCommand: fakeGitRunner(events, { ahead: 1, remoteUrl: nonGitHubRemote }) })

    const status = await service.pushCurrentBranch(project("/repo"))

    expect(events).toContain("push")
    expect(status.ahead).toBe(0)
  })

  it("pushes explicitly when the upstream points at another branch", async () => {
    // A feature branch created (pre --no-track fix) from origin/main tracks
    // origin/main; a plain `git push` would refuse. Expect the explicit form.
    const events: string[] = []
    const service = makeProjectGitService({
      runCommand: fakeGitRunner(events, { ahead: 1, upstream: "origin/main", remoteUrl: nonGitHubRemote }),
    })

    const status = await service.pushCurrentBranch(project("/repo"))

    expect(events).toContain("push-upstream")
    expect(status.ahead).toBe(0)
  })

  it("pulls the current branch fast-forward when it is behind", async () => {
    const events: string[] = []
    const service = makeProjectGitService({
      runCommand: fakeGitRunner(events, { ahead: 0, behind: 2, remoteUrl: nonGitHubRemote }),
    })

    const status = await service.pullCurrentBranch(project("/repo"))

    expect(events).toContain("pull:origin feat/git-header")
    expect(status.behind).toBe(0)
  })

  it("refuses to pull with local changes or without an upstream", async () => {
    const dirty = makeProjectGitService({
      runCommand: fakeGitRunner([], { dirty: true, behind: 1, remoteUrl: nonGitHubRemote }),
    })
    await expect(dirty.pullCurrentBranch(project("/repo"))).rejects.toThrow("local changes")

    const noUpstream = makeProjectGitService({
      runCommand: fakeGitRunner([], { hasUpstream: false, remoteBranches: ["main"], remoteUrl: nonGitHubRemote }),
    })
    await expect(noUpstream.pullCurrentBranch(project("/repo"))).rejects.toThrow("no upstream")
  })

  it("checks out default, pulls latest, and deletes the merged local branch safely", async () => {
    const events: string[] = []
    const service = makeProjectGitService({
      runCommand: fakeGitRunner(events, {
        branch: "feat/git-header",
        ahead: 0,
        behind: 0,
        remoteUrl: nonGitHubRemote,
      }),
    })

    const checkedOut = await service.checkoutDefaultBranch(project("/repo"))
    const pulled = await service.pullDefaultBranch(project("/repo"))
    const cleaned = await service.deleteLocalBranch(project("/repo"), "feat/git-header")

    expect(checkedOut.branch).toBe("main")
    expect(pulled.branch).toBe("main")
    expect(cleaned.branch).toBe("main")
    expect(events).toContain("checkout:main")
    expect(events).toContain("pull-default")
    expect(events).toContain("delete-branch:feat/git-header")
  })

  it("rejects dirty checkout cleanup and deleting the current branch", async () => {
    const dirtyService = makeProjectGitService({ runCommand: fakeGitRunner([], { dirty: true, remoteUrl: nonGitHubRemote }) })
    await expect(dirtyService.checkoutDefaultBranch(project("/repo"))).rejects.toThrow("local changes")

    const cleanService = makeProjectGitService({ runCommand: fakeGitRunner([], { remoteUrl: nonGitHubRemote }) })
    await expect(cleanService.deleteLocalBranch(project("/repo"), "feat/git-header")).rejects.toThrow("Checkout another branch")
  })
})

async function initRepo(repoPath: string) {
  await mkdir(repoPath)
  await pexec("git", ["init", "-b", "main"], { cwd: repoPath })
  await pexec("git", ["config", "user.email", "test@example.com"], { cwd: repoPath })
  await pexec("git", ["config", "user.name", "Test User"], { cwd: repoPath })
  await pexec("git", ["commit", "--allow-empty", "-m", "initial"], { cwd: repoPath })
}

interface FakeGitOptions {
  branch?: string
  dirty?: boolean
  ahead?: number
  behind?: number
  hasUpstream?: boolean
  /** Upstream ref; defaults to origin/<branch>. */
  upstream?: string
  localBranches?: string[]
  remoteBranches?: string[]
  remoteUrl?: string | null
}

function fakeGitRunner(events: string[] = [], options: FakeGitOptions = {}): CommandRunner {
  let branch = options.branch ?? "feat/git-header"
  let dirty = options.dirty ?? false
  let ahead = options.ahead ?? 1
  let behind = options.behind ?? 0
  let hasUpstream = options.hasUpstream ?? true
  let upstreamOverride = options.upstream ?? null
  const localBranches = new Set(options.localBranches ?? ["main", branch])
  const remoteBranches = new Set(options.remoteBranches ?? ["main", branch])
  const remoteUrl = options.remoteUrl === undefined ? "git@github.com:acme/repo.git" : options.remoteUrl
  let staged = false

  return async (command, args) => {
    if (command === "gh") return { stdout: "token\n", stderr: "" }
    if (command !== "git") throw new Error(`Unexpected command: ${command}`)
    const gitArgs = args.slice(2)
    const key = gitArgs.join(" ")

    if (key === "rev-parse --is-inside-work-tree") return { stdout: "true\n", stderr: "" }
    if (key === "rev-parse --abbrev-ref HEAD") return { stdout: `${branch}\n`, stderr: "" }
    if (key === "rev-parse HEAD") return { stdout: "abc123\n", stderr: "" }
    if (key === "status --porcelain=v1") return { stdout: dirty ? " M file.txt\n" : "", stderr: "" }
    if (key === "config --get remote.origin.url") {
      if (!remoteUrl) throw new Error("missing remote")
      return { stdout: `${remoteUrl}\n`, stderr: "" }
    }
    if (key === "symbolic-ref --short refs/remotes/origin/HEAD") return { stdout: "origin/main\n", stderr: "" }
    if (key === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") {
      if (!hasUpstream) throw new Error("missing upstream")
      return { stdout: `${upstreamOverride ?? `origin/${branch}`}\n`, stderr: "" }
    }
    if (key.startsWith("rev-parse origin/")) return { stdout: "remote123\n", stderr: "" }
    if (key.startsWith("rev-list --left-right --count ")) {
      return { stdout: `${behind}\t${ahead}\n`, stderr: "" }
    }
    if (key === "fetch --prune origin") {
      events.push("fetch")
      return { stdout: "", stderr: "" }
    }
    if (key === "add -A") {
      events.push("add")
      staged = dirty
      return { stdout: "", stderr: "" }
    }
    if (key === "diff --cached --quiet") {
      if (!staged) return { stdout: "", stderr: "" }
      throw Object.assign(new Error("diff"), { code: 1 })
    }
    if (key.startsWith("commit -m ")) {
      const message = key.slice("commit -m ".length)
      events.push(`commit:${message}`)
      dirty = false
      staged = false
      ahead += 1
      return { stdout: "", stderr: "" }
    }
    if (key === `checkout -b feat/save-work`) {
      events.push("checkout-new:feat/save-work")
      branch = "feat/save-work"
      localBranches.add(branch)
      hasUpstream = false
      ahead = 0
      behind = 0
      return { stdout: "", stderr: "" }
    }
    if (key === "checkout main") {
      events.push("checkout:main")
      branch = "main"
      hasUpstream = true
      ahead = 0
      behind = 0
      return { stdout: "", stderr: "" }
    }
    if (key === "pull --ff-only origin main") {
      events.push("pull-default")
      behind = 0
      return { stdout: "", stderr: "" }
    }
    if (key === "branch -d feat/git-header") {
      events.push("delete-branch:feat/git-header")
      localBranches.delete("feat/git-header")
      return { stdout: "", stderr: "" }
    }
    if (key.startsWith("pull --ff-only ")) {
      events.push(`pull:${key.slice("pull --ff-only ".length)}`)
      behind = 0
      return { stdout: "", stderr: "" }
    }
    if (key === `push -u origin HEAD:refs/heads/${branch}`) {
      events.push("push-upstream")
      events.push("push")
      hasUpstream = true
      upstreamOverride = `origin/${branch}`
      remoteBranches.add(branch)
      ahead = 0
      return { stdout: "", stderr: "" }
    }
    if (key === "push") {
      events.push("push")
      remoteBranches.add(branch)
      ahead = 0
      return { stdout: "", stderr: "" }
    }
    if (key.startsWith("show-ref --verify --quiet refs/heads/")) {
      const ref = key.slice("show-ref --verify --quiet refs/heads/".length)
      if (localBranches.has(ref)) return { stdout: "", stderr: "" }
      throw new Error("missing ref")
    }
    if (key.startsWith("show-ref --verify --quiet refs/remotes/origin/")) {
      const ref = key.slice("show-ref --verify --quiet refs/remotes/origin/".length)
      if (remoteBranches.has(ref)) return { stdout: "", stderr: "" }
      throw new Error("missing ref")
    }
    throw new Error(`Unexpected git args: ${key}`)
  }
}

function fakeGitHubClient(events: string[] = []) {
  const pullsCreate = vi.fn(async () => {
    events.push("create-pr")
    return { data: fakePullRequest() }
  })
  const pullsGet = vi.fn(async () => ({ data: detailedPullRequest() }))
  const pullsMerge = vi.fn(async () => ({ data: { merged: true, message: "merged", sha: "merge-sha" } }))
  const reposGet = vi.fn(async () => ({ data: { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true } }))
  const paginate = vi.fn(async (..._args: unknown[]) => [] as unknown[])
  return {
    pullsCreate,
    pullsGet,
    pullsMerge,
    reposGet,
    paginate,
    value: {
      paginate,
      rest: {
        pulls: {
          list: vi.fn(),
          create: pullsCreate,
          get: pullsGet,
          merge: pullsMerge,
          listReviews: vi.fn(),
          listReviewComments: vi.fn(),
        },
        repos: {
          get: reposGet,
          listCommitStatusesForRef: vi.fn(),
        },
        issues: {
          listComments: vi.fn(),
        },
        checks: {
          listForRef: vi.fn(),
        },
      },
    } as never,
  }
}

function fakePullRequest(
  input: { number?: number; title?: string; draft?: boolean; headSha?: string; state?: string; mergedAt?: string | null } = {},
) {
  return {
    number: input.number ?? 42,
    title: input.title ?? "Git header",
    html_url: `https://github.com/acme/repo/pull/${input.number ?? 42}`,
    state: input.state ?? "open",
    draft: input.draft ?? false,
    merged_at: input.mergedAt ?? null,
    head: { ref: "feat/git-header", sha: input.headSha ?? "abc123" },
    base: { ref: "main" },
    user: { login: "octocat" },
  }
}

function detailedPullRequest(input: { number?: number; headSha?: string } = {}) {
  return {
    ...fakePullRequest(input),
    mergeable: true,
    mergeable_state: "clean",
  }
}
