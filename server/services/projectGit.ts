import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { Octokit } from "@octokit/rest"
import type {
  GitHubCommentSummary,
  GitHubMergeAvailability,
  GitHubMergeMethod,
  GitHubReviewSummary,
  GitHubStatusRow,
  Project,
  ProjectGitRemote,
  ProjectGitStatus,
  ProjectPullRequestDetails,
  PullRequestMergeResult,
  PullRequestSummary,
} from "@shared/types.ts"
import { HttpError } from "../api/_util.ts"

const pexec = promisify(execFile)
const GIT_TIMEOUT_MS = 10_000
const GITHUB_TIMEOUT_MS = 30_000
const MAX_BUFFER = 4 << 20
const MERGE_METHODS: GitHubMergeMethod[] = ["merge", "squash", "rebase"]

interface CommandOptions {
  cwd?: string
  input?: string
  timeout?: number
  maxBuffer?: number
}

interface CommandResult {
  stdout: string
  stderr: string
}

export type CommandRunner = (command: string, args: string[], options?: CommandOptions) => Promise<CommandResult>

type GitHubClient = InstanceType<typeof Octokit>

interface GitHubAuth {
  token: string | null
  authenticated: boolean
}

interface ProjectGitDeps {
  runCommand: CommandRunner
  createGitHubClient: (host: string, token: string | null) => GitHubClient
}

interface GitHubRemoteInfo {
  host: string
  owner: string
  repo: string
}

interface StatusContext {
  status: ProjectGitStatus
  github: GitHubRemoteInfo | null
  auth: GitHubAuth | null
  client: GitHubClient | null
}

interface StatusOptions {
  refresh?: boolean
}

interface RefreshResult {
  remoteFetchedAt: string | null
  remoteFetchError: string | null
}

interface AheadBehindResult {
  ahead: number
  behind: number
  upstream: string | null
  hasUpstream: boolean
  published: boolean
  remoteHeadSha: string | null
}

export async function defaultRunCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const execOptions = {
    cwd: options.cwd,
    timeout: options.timeout ?? GIT_TIMEOUT_MS,
    maxBuffer: options.maxBuffer ?? MAX_BUFFER,
  }

  if (options.input === undefined) {
    try {
      const { stdout, stderr } = await pexec(command, args, execOptions)
      return { stdout, stderr }
    } catch (error) {
      throw toCommandError(command, args, error)
    }
  }

  return new Promise((resolve, reject) => {
    const child = execFile(command, args, execOptions, (error, stdout, stderr) => {
      if (error) {
        reject(toCommandError(command, args, { ...error, stdout, stderr }))
        return
      }
      resolve({ stdout, stderr })
    })
    child.stdin?.end(options.input)
  })
}

function toCommandError(command: string, args: string[], error: unknown): Error {
  const e = error as Error & { stdout?: string; stderr?: string; code?: number | string | null }
  const stderr = e.stderr?.toString().trim()
  const message = stderr || e.message || `${command} ${args.join(" ")} failed`
  const next = new Error(message)
  Object.assign(next, { command, args, stdout: e.stdout, stderr: e.stderr, code: e.code })
  return next
}

export function parseGitHubRemote(remoteUrl: string | null): GitHubRemoteInfo | null {
  if (!remoteUrl) return null
  const trimmed = remoteUrl.trim()

  const scp = trimmed.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?\/?$/i)
  if (scp) return githubDotComOnly({ host: scp[1], owner: scp[2], repo: scp[3] })

  try {
    const url = new URL(trimmed)
    const [owner, repo] = url.pathname.replace(/^\/+/, "").split("/")
    if (!owner || !repo) return null
    return githubDotComOnly({ host: url.hostname, owner, repo: repo.replace(/\.git$/i, "") })
  } catch {
    return null
  }
}

function githubDotComOnly(remote: GitHubRemoteInfo): GitHubRemoteInfo | null {
  if (remote.host.toLowerCase() !== "github.com") return null
  return {
    host: "github.com",
    owner: remote.owner,
    repo: remote.repo.replace(/\.git$/i, ""),
  }
}

export function validateBranchName(name: string): string {
  const branch = name.trim()
  if (!branch) throw new HttpError(400, "Branch name is required")
  if (branch.startsWith("-") || branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".")) {
    throw new HttpError(400, "Invalid branch name")
  }
  if (
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.endsWith(".lock") ||
    /[\s~^:?*[\\\]\x00-\x1f\x7f]/.test(branch)
  ) {
    throw new HttpError(400, "Invalid branch name")
  }
  return branch
}

function defaultCreateGitHubClient(host: string, token: string | null): GitHubClient {
  const options = token ? { auth: token } : {}
  if (host === "github.com") return new Octokit(options)
  return new Octokit({ ...options, baseUrl: `https://${host}/api/v3` })
}

export function makeProjectGitService(deps: Partial<ProjectGitDeps> = {}) {
  const runCommand = deps.runCommand ?? defaultRunCommand
  const createGitHubClient = deps.createGitHubClient ?? defaultCreateGitHubClient

  async function runGit(projectPath: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
    const { stdout } = await runCommand("git", ["-C", projectPath, ...args], { timeout, maxBuffer: MAX_BUFFER })
    return stdout.trim()
  }

  async function optionalGit(projectPath: string, args: string[]): Promise<string | null> {
    try {
      const value = await runGit(projectPath, args)
      return value || null
    } catch {
      return null
    }
  }

  async function refExists(projectPath: string, ref: string): Promise<boolean> {
    try {
      await runGit(projectPath, ["show-ref", "--verify", "--quiet", ref])
      return true
    } catch {
      return false
    }
  }

  async function getDefaultBranch(projectPath: string): Promise<string | null> {
    const originHead = await optionalGit(projectPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
    if (originHead?.startsWith("origin/")) return originHead.slice("origin/".length)
    if (await refExists(projectPath, "refs/heads/main")) return "main"
    if (await refExists(projectPath, "refs/heads/master")) return "master"
    return (await optionalGit(projectPath, ["config", "--get", "init.defaultBranch"])) ?? "main"
  }

  async function refreshRemote(projectPath: string, remoteUrl: string | null): Promise<RefreshResult> {
    if (!remoteUrl) return { remoteFetchedAt: null, remoteFetchError: null }
    try {
      await runGit(projectPath, ["fetch", "--prune", "origin"], GITHUB_TIMEOUT_MS)
      return { remoteFetchedAt: new Date().toISOString(), remoteFetchError: null }
    } catch (error) {
      return { remoteFetchedAt: null, remoteFetchError: (error as Error).message || "Remote fetch failed" }
    }
  }

  async function aheadBehind(
    projectPath: string,
    branch: string | null,
    defaultBranch: string | null,
  ): Promise<AheadBehindResult> {
    if (!branch || branch === "HEAD") {
      return { ahead: 0, behind: 0, upstream: null, hasUpstream: false, published: false, remoteHeadSha: null }
    }

    let upstream = await optionalGit(projectPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
    const sameBranchRemote = `refs/remotes/origin/${branch}`
    const published = await refExists(projectPath, sameBranchRemote)
    if (!upstream) {
      const defaultRemote = defaultBranch ? `refs/remotes/origin/${defaultBranch}` : null
      if (published) upstream = `origin/${branch}`
      else if (branch === defaultBranch && defaultRemote && (await refExists(projectPath, defaultRemote))) {
        upstream = `origin/${defaultBranch}`
      }
    }
    const remoteHeadSha = upstream ? await optionalGit(projectPath, ["rev-parse", upstream]) : null
    if (!upstream) {
      return { ahead: 0, behind: 0, upstream: null, hasUpstream: false, published, remoteHeadSha: null }
    }

    const counts = await optionalGit(projectPath, ["rev-list", "--left-right", "--count", `${upstream}...HEAD`])
    const [behindRaw, aheadRaw] = counts?.split(/\s+/) ?? []
    return {
      ahead: Number.parseInt(aheadRaw ?? "0", 10) || 0,
      behind: Number.parseInt(behindRaw ?? "0", 10) || 0,
      upstream,
      hasUpstream: true,
      published,
      remoteHeadSha,
    }
  }

  async function hasStagedChanges(projectPath: string): Promise<boolean> {
    try {
      await runGit(projectPath, ["diff", "--cached", "--quiet"])
      return false
    } catch (error) {
      const code = (error as { code?: number | string | null }).code
      if (code === 1 || code === "1") return true
      throw error
    }
  }

  async function resolveGitHubAuth(host: string): Promise<GitHubAuth> {
    try {
      const { stdout } = await runCommand("gh", ["auth", "token", "--hostname", host], {
        timeout: GITHUB_TIMEOUT_MS,
        maxBuffer: 1 << 20,
      })
      const token = stdout.trim()
      if (token) return { token, authenticated: true }
    } catch {
      // Fall through to the git credential helper.
    }

    try {
      const { stdout } = await runCommand("git", ["credential", "fill"], {
        input: `protocol=https\nhost=${host}\n\n`,
        timeout: GITHUB_TIMEOUT_MS,
        maxBuffer: 1 << 20,
      })
      const token = parseCredentialToken(stdout)
      if (token) return { token, authenticated: true }
    } catch {
      // Public repositories can still be queried without auth.
    }

    return { token: null, authenticated: false }
  }

  async function githubContext(remote: GitHubRemoteInfo): Promise<{ auth: GitHubAuth; client: GitHubClient }> {
    const auth = await resolveGitHubAuth(remote.host)
    return { auth, client: createGitHubClient(remote.host, auth.token) }
  }

  async function ensureGitHubContext(context: StatusContext, remote: GitHubRemoteInfo) {
    if (context.client && context.auth) return { auth: context.auth, client: context.client }
    return githubContext(remote)
  }

  async function getStatusContext(project: Pick<Project, "repoPath">, options: StatusOptions = {}): Promise<StatusContext> {
    const projectPath = project.repoPath
    const inside = await optionalGit(projectPath, ["rev-parse", "--is-inside-work-tree"])
    if (inside !== "true") {
      return {
        status: emptyStatus(projectPath),
        github: null,
        auth: null,
        client: null,
      }
    }

    const [branchRaw, headSha, dirtyRaw, remoteUrl] = await Promise.all([
      optionalGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
      optionalGit(projectPath, ["rev-parse", "HEAD"]),
      optionalGit(projectPath, ["status", "--porcelain=v1"]),
      optionalGit(projectPath, ["config", "--get", "remote.origin.url"]),
    ])
    const branch = branchRaw && branchRaw !== "HEAD" ? branchRaw : branchRaw
    const refresh = options.refresh
      ? await refreshRemote(projectPath, remoteUrl)
      : { remoteFetchedAt: null, remoteFetchError: null }
    const defaultBranch = await getDefaultBranch(projectPath)
    const counts = await aheadBehind(projectPath, branch, defaultBranch)
    const github = parseGitHubRemote(remoteUrl)
    const remote = toProjectRemote(remoteUrl, github)
    let auth: GitHubAuth | null = null
    let client: GitHubClient | null = null
    let pullRequest: PullRequestSummary | null = null
    let githubError: string | null = null

    if (github && branch && branch !== "HEAD" && branch !== defaultBranch && headSha) {
      try {
        const context = await githubContext(github)
        auth = context.auth
        client = context.client
        pullRequest = await findBranchPullRequest(context.client, github, branch, headSha)
      } catch (error) {
        githubError = githubErrorMessage(error)
      }
    } else if (github) {
      try {
        const context = await githubContext(github)
        auth = context.auth
        client = context.client
      } catch {
        auth = { token: null, authenticated: false }
      }
    }

    return {
      status: {
        path: projectPath,
        isGit: true,
        branch,
        defaultBranch,
        headSha,
        remoteHeadSha: counts.remoteHeadSha,
        dirty: !!dirtyRaw,
        ahead: counts.ahead,
        behind: counts.behind,
        upstream: counts.upstream,
        hasUpstream: counts.hasUpstream,
        published: counts.published,
        canPush: !!branch && branch !== "HEAD" && !!remoteUrl,
        canPull: !!branch && branch !== "HEAD" && branch === defaultBranch && !!remoteUrl,
        refreshedAt: new Date().toISOString(),
        remoteFetchedAt: refresh.remoteFetchedAt,
        remoteFetchError: refresh.remoteFetchError,
        remote,
        pullRequest,
        github: github ? { authenticated: auth?.authenticated ?? false, error: githubError } : null,
      },
      github,
      auth,
      client,
    }
  }

  async function getStatus(project: Pick<Project, "repoPath">, options: StatusOptions = {}): Promise<ProjectGitStatus> {
    return (await getStatusContext(project, options)).status
  }

  async function createBranch(project: Pick<Project, "repoPath">, name: string): Promise<ProjectGitStatus> {
    const branch = validateBranchName(name)
    const context = await getStatusContext(project)
    if (!context.status.isGit) throw new HttpError(400, "Selected folder is not a Git worktree")
    if (await refExists(project.repoPath, `refs/heads/${branch}`)) {
      throw new HttpError(409, `Branch already exists: ${branch}`)
    }
    const defaultBranch = context.status.defaultBranch ?? "main"
    const startPoint = (await refExists(project.repoPath, `refs/remotes/origin/${defaultBranch}`))
      ? `origin/${defaultBranch}`
      : defaultBranch
    await runGit(project.repoPath, ["checkout", "-b", branch, startPoint])
    return getStatus(project, { refresh: true })
  }

  async function commitChanges(
    project: Pick<Project, "repoPath">,
    input: { message: string; branchName?: string | null },
  ): Promise<ProjectGitStatus> {
    const message = input.message.trim()
    if (!message) throw new HttpError(400, "Commit message is required")
    const context = await getStatusContext(project)
    const status = context.status
    if (!status.isGit) throw new HttpError(400, "Selected folder is not a Git worktree")
    if (!status.dirty) throw new HttpError(400, "No local changes to commit")
    if (!status.branch || status.branch === "HEAD") {
      throw new HttpError(400, "Checkout or create a branch before committing")
    }

    const requestedBranch = input.branchName?.trim() ? validateBranchName(input.branchName) : null
    if (requestedBranch && requestedBranch !== status.branch) {
      if (await refExists(project.repoPath, `refs/heads/${requestedBranch}`)) {
        throw new HttpError(409, `Branch already exists: ${requestedBranch}`)
      }
      await runGit(project.repoPath, ["checkout", "-b", requestedBranch])
    }

    await runGit(project.repoPath, ["add", "-A"])
    if (!(await hasStagedChanges(project.repoPath))) {
      throw new HttpError(400, "No changes to commit after staging")
    }
    await runGit(project.repoPath, ["commit", "-m", message])
    return getStatus(project, { refresh: true })
  }

  async function pushCurrentBranch(project: Pick<Project, "repoPath">): Promise<ProjectGitStatus> {
    const context = await getStatusContext(project, { refresh: true })
    const status = context.status
    if (!status.isGit) throw new HttpError(400, "Selected folder is not a Git worktree")
    if (!status.remote?.url) throw new HttpError(400, "Selected Git repo has no origin remote")
    if (!status.branch || status.branch === "HEAD") throw new HttpError(400, "Cannot push from a detached HEAD")
    if (status.hasUpstream) {
      await runGit(project.repoPath, ["push"], GITHUB_TIMEOUT_MS)
    } else {
      await runGit(project.repoPath, ["push", "-u", "origin", `HEAD:refs/heads/${status.branch}`], GITHUB_TIMEOUT_MS)
    }
    return getStatus(project, { refresh: true })
  }

  async function checkoutDefaultBranch(project: Pick<Project, "repoPath">): Promise<ProjectGitStatus> {
    const context = await getStatusContext(project, { refresh: true })
    const status = context.status
    if (!status.isGit) throw new HttpError(400, "Selected folder is not a Git worktree")
    if (status.dirty) throw new HttpError(400, "Commit or discard local changes before checking out the default branch")
    const defaultBranch = status.defaultBranch ?? "main"
    if (status.branch === defaultBranch) return status
    if (await refExists(project.repoPath, `refs/heads/${defaultBranch}`)) {
      await runGit(project.repoPath, ["checkout", defaultBranch])
    } else if (await refExists(project.repoPath, `refs/remotes/origin/${defaultBranch}`)) {
      await runGit(project.repoPath, ["checkout", "-b", defaultBranch, `origin/${defaultBranch}`])
    } else {
      throw new HttpError(400, `Default branch not found locally or on origin: ${defaultBranch}`)
    }
    return getStatus(project, { refresh: true })
  }

  async function pullDefaultBranch(project: Pick<Project, "repoPath">): Promise<ProjectGitStatus> {
    const context = await getStatusContext(project, { refresh: true })
    const status = context.status
    if (!status.isGit) throw new HttpError(400, "Selected folder is not a Git worktree")
    if (status.dirty) throw new HttpError(400, "Commit or discard local changes before pulling")
    const defaultBranch = status.defaultBranch ?? "main"
    if (status.branch !== defaultBranch) throw new HttpError(400, `Checkout ${defaultBranch} before pulling latest`)
    if (!status.remote?.url) throw new HttpError(400, "Selected Git repo has no origin remote")
    await runGit(project.repoPath, ["pull", "--ff-only", "origin", defaultBranch], GITHUB_TIMEOUT_MS)
    return getStatus(project, { refresh: true })
  }

  async function deleteLocalBranch(project: Pick<Project, "repoPath">, name: string): Promise<ProjectGitStatus> {
    const branch = validateBranchName(name)
    const context = await getStatusContext(project)
    const status = context.status
    if (!status.isGit) throw new HttpError(400, "Selected folder is not a Git worktree")
    if (status.branch === branch) throw new HttpError(400, "Checkout another branch before deleting this one")
    if (status.defaultBranch === branch) throw new HttpError(400, "Cannot delete the default branch")
    if (!(await refExists(project.repoPath, `refs/heads/${branch}`))) {
      throw new HttpError(404, `Local branch not found: ${branch}`)
    }
    await runGit(project.repoPath, ["branch", "-d", branch])
    return getStatus(project, { refresh: true })
  }

  async function getPullRequest(
    project: Pick<Project, "repoPath">,
    options: StatusOptions = {},
  ): Promise<ProjectPullRequestDetails> {
    const context = await getStatusContext(project, options)
    const { status, github } = context
    if (!status.isGit) throw new HttpError(400, "Selected folder is not a Git worktree")
    if (!github) return emptyPullRequestDetails(status)
    const { client } = await ensureGitHubContext(context, github)
    const pr = status.pullRequest
    if (!pr) return emptyPullRequestDetails(status)
    return getPullRequestDetails(client, github, status, pr.number)
  }

  async function createPullRequest(
    project: Pick<Project, "repoPath">,
    input: { title?: string; body?: string; base?: string },
  ): Promise<ProjectPullRequestDetails> {
    const context = await getStatusContext(project, { refresh: true })
    const { status, github } = context
    if (!status.isGit) throw new HttpError(400, "Selected folder is not a Git worktree")
    if (!github) throw new HttpError(400, "Selected Git remote is not a supported GitHub.com remote")
    if (!status.branch || status.branch === "HEAD") throw new HttpError(400, "Cannot open a PR from a detached HEAD")
    if (status.branch === status.defaultBranch) throw new HttpError(400, "Create a feature branch before opening a PR")
    const initialGithub = await ensureGitHubContext(context, github)
    if (status.pullRequest) return getPullRequestDetails(initialGithub.client, github, status, status.pullRequest.number)

    await runGit(project.repoPath, ["push", "-u", "origin", `HEAD:refs/heads/${status.branch}`], GITHUB_TIMEOUT_MS)
    const { client } = initialGithub
    const title = input.title?.trim() || titleFromBranch(status.branch)
    const body = input.body ?? (await readPullRequestTemplate(project.repoPath)) ?? ""
    const response = await client.rest.pulls.create({
      owner: github.owner,
      repo: github.repo,
      title,
      body,
      head: status.branch,
      base: input.base?.trim() || status.defaultBranch || "main",
      draft: false,
    })
    return getPullRequestDetails(client, github, { ...status, pullRequest: toPullRequestSummary(response.data) }, response.data.number)
  }

  async function mergePullRequest(
    project: Pick<Project, "repoPath">,
    number: number,
    input: { confirm: boolean; method: GitHubMergeMethod; expectedHeadSha: string },
  ): Promise<PullRequestMergeResult> {
    if (!input.confirm) throw new HttpError(400, "Merge confirmation is required")
    if (!MERGE_METHODS.includes(input.method)) throw new HttpError(400, "Invalid merge method")
    const context = await getStatusContext(project)
    const { status, github } = context
    if (!status.isGit) throw new HttpError(400, "Selected folder is not a Git worktree")
    if (!github) throw new HttpError(400, "Selected Git remote is not a supported GitHub.com remote")
    const { client } = await ensureGitHubContext(context, github)
    const [pull, repo] = await Promise.all([
      client.rest.pulls.get({ owner: github.owner, repo: github.repo, pull_number: number }),
      client.rest.repos.get({ owner: github.owner, repo: github.repo }),
    ])
    const expectedSha = input.expectedHeadSha.trim()
    if (!expectedSha) throw new HttpError(400, "Expected head SHA is required")
    if (pull.data.head.sha !== expectedSha) throw new HttpError(409, "PR head changed; refresh before merging")
    const allowed = allowedMergeMethods(repo.data)
    if (!allowed.includes(input.method)) throw new HttpError(400, `${input.method} merge is disabled for this repository`)

    const merged = await client.rest.pulls.merge({
      owner: github.owner,
      repo: github.repo,
      pull_number: number,
      merge_method: input.method,
      sha: expectedSha,
    })
    return {
      merged: !!merged.data.merged,
      message: merged.data.message,
      sha: merged.data.sha ?? null,
    }
  }

  return {
    getStatus,
    createBranch,
    commitChanges,
    pushCurrentBranch,
    checkoutDefaultBranch,
    pullDefaultBranch,
    deleteLocalBranch,
    getPullRequest,
    createPullRequest,
    mergePullRequest,
  }
}

function emptyStatus(projectPath: string): ProjectGitStatus {
  return {
    path: projectPath,
    isGit: false,
    branch: null,
    defaultBranch: null,
    headSha: null,
    remoteHeadSha: null,
    dirty: false,
    ahead: 0,
    behind: 0,
    upstream: null,
    hasUpstream: false,
    published: false,
    canPush: false,
    canPull: false,
    refreshedAt: new Date().toISOString(),
    remoteFetchedAt: null,
    remoteFetchError: null,
    remote: null,
    pullRequest: null,
    github: null,
  }
}

function toProjectRemote(remoteUrl: string | null, github: GitHubRemoteInfo | null): ProjectGitRemote | null {
  if (!remoteUrl) return null
  return {
    name: "origin",
    url: remoteUrl,
    host: github?.host ?? null,
    owner: github?.owner ?? null,
    repo: github?.repo ?? null,
    isGitHub: github !== null,
  }
}

function parseCredentialToken(output: string): string | null {
  const lines = output.split(/\r?\n/)
  for (const key of ["password", "oauth_token"]) {
    const line = lines.find((l) => l.startsWith(`${key}=`))
    const value = line?.slice(key.length + 1).trim()
    if (value) return value
  }
  return null
}

async function findBranchPullRequest(
  client: GitHubClient,
  github: GitHubRemoteInfo,
  branch: string,
  headSha: string,
): Promise<PullRequestSummary | null> {
  const byBranch = await client.paginate(client.rest.pulls.list, {
    owner: github.owner,
    repo: github.repo,
    state: "all",
    head: `${github.owner}:${branch}`,
    sort: "updated",
    direction: "desc",
    per_page: 100,
  })
  const open = byBranch.find((pr) => pr.state === "open" && (pr.head.sha === headSha || pr.head.ref === branch))
  if (open) return toPullRequestSummary(open)
  const merged = byBranch.find((pr) => pr.merged_at && (pr.head.sha === headSha || pr.head.ref === branch))
  if (merged) return toPullRequestSummary(merged)
  const direct = byBranch.find((pr) => pr.head.sha === headSha || pr.head.ref === branch)
  if (direct) return toPullRequestSummary(direct)

  const allOpen = await client.paginate(client.rest.pulls.list, {
    owner: github.owner,
    repo: github.repo,
    state: "open",
    per_page: 100,
  })
  const byHead = allOpen.find((pr) => pr.head.sha === headSha)
  return byHead ? toPullRequestSummary(byHead) : null
}

async function getPullRequestDetails(
  client: GitHubClient,
  github: GitHubRemoteInfo,
  status: ProjectGitStatus,
  number: number,
): Promise<ProjectPullRequestDetails> {
  const [pull, repo, checks, commitStatuses, reviews, issueComments, reviewComments] = await Promise.all([
    client.rest.pulls.get({ owner: github.owner, repo: github.repo, pull_number: number }),
    client.rest.repos.get({ owner: github.owner, repo: github.repo }),
    client.paginate(client.rest.checks.listForRef, {
      owner: github.owner,
      repo: github.repo,
      ref: status.headSha ?? "HEAD",
      per_page: 100,
    }),
    client.paginate(client.rest.repos.listCommitStatusesForRef, {
      owner: github.owner,
      repo: github.repo,
      ref: status.headSha ?? "HEAD",
      per_page: 100,
    }),
    client.paginate(client.rest.pulls.listReviews, {
      owner: github.owner,
      repo: github.repo,
      pull_number: number,
      per_page: 100,
    }),
    client.paginate(client.rest.issues.listComments, {
      owner: github.owner,
      repo: github.repo,
      issue_number: number,
      per_page: 100,
    }),
    client.paginate(client.rest.pulls.listReviewComments, {
      owner: github.owner,
      repo: github.repo,
      pull_number: number,
      per_page: 100,
    }),
  ])

  const pullSummary = toPullRequestSummary(pull.data)
  return {
    status: { ...status, pullRequest: pullSummary },
    pullRequest: pullSummary,
    checks: [
      ...checks.map(toCheckRow),
      ...commitStatuses.map(toCommitStatusRow),
    ].sort(sortStatusRows),
    reviews: reviews.map(toReviewSummary),
    comments: [
      ...issueComments.map(toIssueCommentSummary),
      ...reviewComments.map(toReviewCommentSummary),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    merge: mergeAvailability(pull.data, repo.data),
  }
}

function emptyPullRequestDetails(status: ProjectGitStatus): ProjectPullRequestDetails {
  return { status, pullRequest: null, checks: [], reviews: [], comments: [], merge: null }
}

function toPullRequestSummary(pr: {
  number: number
  title: string
  html_url: string
  state: string
  draft?: boolean | null
  merged_at?: string | null
  head: { ref: string; sha: string; user?: { login?: string | null } | null }
  base: { ref: string }
  user?: { login?: string | null } | null
}): PullRequestSummary {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    state: pr.state,
    draft: !!pr.draft,
    merged: !!pr.merged_at,
    mergedAt: pr.merged_at ?? null,
    headRefName: pr.head.ref,
    baseRefName: pr.base.ref,
    headSha: pr.head.sha,
    author: pr.user?.login ?? null,
  }
}

function toCheckRow(check: {
  id: number
  name: string
  status: string
  conclusion: string | null
  details_url: string | null
  html_url: string | null
  started_at: string | null
  completed_at: string | null
}): GitHubStatusRow {
  return {
    id: `check-${check.id}`,
    type: "check",
    name: check.name,
    status: check.status,
    conclusion: check.conclusion,
    details: check.conclusion ?? check.status,
    url: check.details_url ?? check.html_url,
    startedAt: check.started_at,
    completedAt: check.completed_at,
  }
}

function toCommitStatusRow(status: {
  id: number
  context: string
  state: string
  description: string | null
  target_url: string | null
  created_at: string
  updated_at: string
}): GitHubStatusRow {
  return {
    id: `status-${status.id}`,
    type: "status",
    name: status.context,
    status: status.state,
    conclusion: status.state,
    details: status.description,
    url: status.target_url,
    startedAt: status.created_at,
    completedAt: status.updated_at,
  }
}

function sortStatusRows(a: GitHubStatusRow, b: GitHubStatusRow): number {
  const aTime = a.completedAt ?? a.startedAt ?? ""
  const bTime = b.completedAt ?? b.startedAt ?? ""
  return bTime.localeCompare(aTime) || a.name.localeCompare(b.name)
}

function toReviewSummary(review: {
  id: number
  user: { login?: string | null } | null
  state: string
  submitted_at?: string | null
  body?: string | null
  html_url?: string | null
}): GitHubReviewSummary {
  return {
    id: review.id,
    author: review.user?.login ?? null,
    state: review.state,
    submittedAt: review.submitted_at ?? null,
    body: review.body ?? null,
    url: review.html_url ?? null,
  }
}

function toIssueCommentSummary(comment: {
  id: number
  user: { login?: string | null } | null
  body?: string | null
  html_url?: string | null
  created_at: string
}): GitHubCommentSummary {
  return {
    id: comment.id,
    type: "issue",
    author: comment.user?.login ?? null,
    body: comment.body ?? "",
    url: comment.html_url ?? null,
    createdAt: comment.created_at,
    path: null,
    line: null,
  }
}

function toReviewCommentSummary(comment: {
  id: number
  user: { login?: string | null } | null
  body?: string | null
  html_url?: string | null
  created_at: string
  path?: string | null
  line?: number | null
  original_line?: number | null
}): GitHubCommentSummary {
  return {
    id: comment.id,
    type: "review",
    author: comment.user?.login ?? null,
    body: comment.body ?? "",
    url: comment.html_url ?? null,
    createdAt: comment.created_at,
    path: comment.path ?? null,
    line: comment.line ?? comment.original_line ?? null,
  }
}

function mergeAvailability(
  pull: {
    state: string
    draft?: boolean | null
    mergeable?: boolean | null
    mergeable_state?: string | null
    head: { sha: string }
  },
  repo: Record<string, unknown>,
): GitHubMergeAvailability {
  const allowedMethods = allowedMergeMethods(repo)
  const blocked: string[] = []
  if (pull.state !== "open") blocked.push("PR is not open")
  if (pull.draft) blocked.push("PR is a draft")
  if (pull.mergeable === false) blocked.push("PR has merge conflicts")
  if (["blocked", "dirty", "behind", "unknown"].includes(pull.mergeable_state ?? "")) {
    blocked.push(`GitHub merge state is ${pull.mergeable_state}`)
  }
  if (allowedMethods.length === 0) blocked.push("No merge methods are enabled")
  const defaultMethod = allowedMethods.includes("squash") ? "squash" : (allowedMethods[0] ?? null)
  return {
    canMerge: blocked.length === 0,
    mergeable: pull.mergeable ?? null,
    state: pull.mergeable_state ?? null,
    blockedReason: blocked.join("; ") || null,
    allowedMethods,
    defaultMethod,
    expectedHeadSha: pull.head.sha,
  }
}

function allowedMergeMethods(repo: Record<string, unknown>): GitHubMergeMethod[] {
  const methods: GitHubMergeMethod[] = []
  if (repo.allow_merge_commit) methods.push("merge")
  if (repo.allow_squash_merge) methods.push("squash")
  if (repo.allow_rebase_merge) methods.push("rebase")
  return methods
}

async function readPullRequestTemplate(projectPath: string): Promise<string | null> {
  const candidates = [
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/pull_request_template.md",
    "PULL_REQUEST_TEMPLATE.md",
    "pull_request_template.md",
  ]
  for (const candidate of candidates) {
    try {
      const content = await readFile(path.join(projectPath, candidate), "utf8")
      if (content.trim()) return content
    } catch {
      // Try the next common template path.
    }
  }
  return null
}

function titleFromBranch(branch: string): string {
  const cleaned = branch
    .replace(/^[a-z]+\//i, "")
    .replace(/[-_]+/g, " ")
    .trim()
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : branch
}

function githubErrorMessage(error: unknown): string {
  const e = error as Error & { status?: number }
  if (e.status === 401 || e.status === 403) return "GitHub authentication failed"
  if (e.status === 404) return "GitHub repository or pull request not found"
  return e.message || "GitHub request failed"
}

export const projectGitService = makeProjectGitService()
