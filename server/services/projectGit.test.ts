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
})

async function initRepo(repoPath: string) {
  await mkdir(repoPath)
  await pexec("git", ["init", "-b", "main"], { cwd: repoPath })
  await pexec("git", ["config", "user.email", "test@example.com"], { cwd: repoPath })
  await pexec("git", ["config", "user.name", "Test User"], { cwd: repoPath })
  await pexec("git", ["commit", "--allow-empty", "-m", "initial"], { cwd: repoPath })
}

function fakeGitRunner(events: string[] = []): CommandRunner {
  return async (command, args) => {
    if (command === "gh") return { stdout: "token\n", stderr: "" }
    if (command !== "git") throw new Error(`Unexpected command: ${command}`)
    const gitArgs = args.slice(2)
    const key = gitArgs.join(" ")

    if (key === "rev-parse --is-inside-work-tree") return { stdout: "true\n", stderr: "" }
    if (key === "rev-parse --abbrev-ref HEAD") return { stdout: "feat/git-header\n", stderr: "" }
    if (key === "rev-parse HEAD") return { stdout: "abc123\n", stderr: "" }
    if (key === "status --porcelain=v1") return { stdout: "", stderr: "" }
    if (key === "config --get remote.origin.url") return { stdout: "git@github.com:acme/repo.git\n", stderr: "" }
    if (key === "symbolic-ref --short refs/remotes/origin/HEAD") return { stdout: "origin/main\n", stderr: "" }
    if (key === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") {
      return { stdout: "origin/feat/git-header\n", stderr: "" }
    }
    if (key === "rev-list --left-right --count origin/feat/git-header...HEAD") {
      return { stdout: "0\t1\n", stderr: "" }
    }
    if (key === "push -u origin HEAD:refs/heads/feat/git-header") {
      events.push("push")
      return { stdout: "", stderr: "" }
    }
    if (key.startsWith("show-ref --verify --quiet")) throw new Error("missing ref")
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

function fakePullRequest(input: { number?: number; title?: string; draft?: boolean; headSha?: string } = {}) {
  return {
    number: input.number ?? 42,
    title: input.title ?? "Git header",
    html_url: `https://github.com/acme/repo/pull/${input.number ?? 42}`,
    state: "open",
    draft: input.draft ?? false,
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
