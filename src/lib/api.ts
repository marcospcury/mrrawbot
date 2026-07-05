import type {
  AgentConfig,
  AgentRunRecord,
  AppInfo,
  ArtifactInfo,
  ArtifactKind,
  ChatMessage,
  FlowConfig,
  FileContent,
  FileTreeEntry,
  GitRepo,
  GitHubMergeMethod,
  ModelEntry,
  NewAgentConfig,
  NewFlowConfig,
  ProjectBranchStatus,
  ProjectGitStatus,
  ProviderConfig,
  ProviderConfigPatch,
  ProjectPullRequestDetails,
  Project,
  ProviderStatus,
  PullRequestMergeResult,
  SessionConfig,
  ThreadChange,
  Thread,
  ThreadFolder,
  ThreadKind,
} from "@shared/types"
import type { PromptAttachmentUploadRequest, PromptAttachmentUploadResponse } from "@shared/attachments"

const BASE = "/api"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  info: () => request<AppInfo>("/info"),

  repos: (refresh = false) => request<GitRepo[]>(`/repos${refresh ? "?refresh=1" : ""}`),
  providers: () => request<ProviderStatus[]>("/providers"),
  providerConfig: () => request<ProviderConfig>("/providers/config"),
  updateProviderConfig: (input: ProviderConfigPatch) =>
    request<ProviderConfig>("/providers/config", { method: "PUT", body: JSON.stringify(input) }),
  models: () => request<ModelEntry[]>("/models"),

  listProjects: () => request<Project[]>("/projects"),
  createProject: (input: { repoPath: string; name?: string; defaultFlowId?: string | null }) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(input) }),
  updateProject: (id: string, input: { name: string; defaultFlowId: string | null }) =>
    request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  getProjectFiles: (projectId: string, dir = "") => {
    const qs = new URLSearchParams()
    if (dir) qs.set("dir", dir)
    const query = qs.toString()
    return request<FileTreeEntry[]>(`/projects/${projectId}/files${query ? `?${query}` : ""}`)
  },
  getProjectFile: (projectId: string, path: string) => {
    const qs = new URLSearchParams({ path })
    return request<FileContent>(`/projects/${projectId}/file?${qs.toString()}`)
  },
  getProjectGitStatus: (projectId: string, refresh = true) =>
    request<ProjectGitStatus>(`/projects/${projectId}/git/status${refresh ? "" : "?refresh=0"}`),
  createProjectBranch: (projectId: string, input: { name: string }) =>
    request<ProjectGitStatus>(`/projects/${projectId}/git/branch`, { method: "POST", body: JSON.stringify(input) }),
  commitProjectChanges: (projectId: string, input: { message: string; branchName?: string | null }) =>
    request<ProjectGitStatus>(`/projects/${projectId}/git/commit`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  pushProjectBranch: (projectId: string) =>
    request<ProjectGitStatus>(`/projects/${projectId}/git/push`, { method: "POST" }),
  pullProjectBranch: (projectId: string) =>
    request<ProjectGitStatus>(`/projects/${projectId}/git/pull`, { method: "POST" }),
  listProjectBranches: (projectId: string) =>
    request<ProjectBranchStatus[]>(`/projects/${projectId}/git/branches`),
  checkoutProjectDefaultBranch: (projectId: string) =>
    request<ProjectGitStatus>(`/projects/${projectId}/git/checkout-default`, { method: "POST" }),
  pullProjectDefaultBranch: (projectId: string) =>
    request<ProjectGitStatus>(`/projects/${projectId}/git/pull-default`, { method: "POST" }),
  deleteProjectBranch: (projectId: string, input: { name: string }) =>
    request<ProjectGitStatus>(`/projects/${projectId}/git/delete-branch`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getProjectPullRequest: (projectId: string, refresh = true) =>
    request<ProjectPullRequestDetails>(`/projects/${projectId}/github/pr${refresh ? "" : "?refresh=0"}`),
  createProjectPullRequest: (projectId: string, input: { title?: string; body?: string; base?: string }) =>
    request<ProjectPullRequestDetails>(`/projects/${projectId}/github/pr`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  mergeProjectPullRequest: (
    projectId: string,
    number: number,
    input: { confirm: boolean; method: GitHubMergeMethod; expectedHeadSha: string },
  ) =>
    request<PullRequestMergeResult>(`/projects/${projectId}/github/pr/${number}/merge`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  artifacts: (projectId: string) => request<ArtifactInfo[]>(`/projects/${projectId}/artifacts`),
  artifactContent: (projectId: string, kind: ArtifactKind, slug: string) =>
    request<{ content: string }>(
      `/projects/${projectId}/artifacts/${kind}/${encodeURIComponent(slug)}/content`,
    ),
  deleteArtifact: (projectId: string, kind: ArtifactKind, slug: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/artifacts/${kind}/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    }),
  threadArtifacts: (threadId: string) => request<ArtifactInfo[]>(`/threads/${threadId}/artifacts`),
  setThreadArtifacts: (threadId: string, artifactIds: string[]) =>
    request<ArtifactInfo[]>(`/threads/${threadId}/artifacts`, {
      method: "PUT",
      body: JSON.stringify({ artifactIds }),
    }),

  listThreads: (projectId: string, includeArchived = false) =>
    request<Thread[]>(`/projects/${projectId}/threads${includeArchived ? "?includeArchived=1" : ""}`),
  createThread: (
    projectId: string,
    input: { title?: string; kind?: ThreadKind; flowId?: string | null; session?: SessionConfig | null } = {},
  ) => request<Thread>(`/projects/${projectId}/threads`, { method: "POST", body: JSON.stringify(input) }),
  updateThread: (
    id: string,
    input: {
      title?: string
      archived?: boolean
      flowId?: string | null
      session?: SessionConfig | null
      branchName?: string | null
      folderId?: string | null
    },
  ) => request<Thread>(`/threads/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteThread: (id: string) => request<void>(`/threads/${id}`, { method: "DELETE" }),
  messages: (threadId: string) => request<ChatMessage[]>(`/threads/${threadId}/messages`),
  clearMessages: (threadId: string) => request<void>(`/threads/${threadId}/messages`, { method: "DELETE" }),
  runs: (threadId: string) => request<AgentRunRecord[]>(`/threads/${threadId}/runs`),
  getThreadChanges: (threadId: string) => request<ThreadChange[]>(`/threads/${threadId}/changes`),
  uploadThreadFile: (threadId: string, input: PromptAttachmentUploadRequest) =>
    request<PromptAttachmentUploadResponse>(`/threads/${threadId}/uploads`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listAgents: () => request<AgentConfig[]>("/agents"),
  createAgent: (input: NewAgentConfig) =>
    request<AgentConfig>("/agents", { method: "POST", body: JSON.stringify(input) }),
  updateAgent: (id: string, input: NewAgentConfig) =>
    request<AgentConfig>(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteAgent: (id: string) => request<void>(`/agents/${id}`, { method: "DELETE" }),

  listFolders: (projectId: string) => request<ThreadFolder[]>(`/projects/${projectId}/folders`),
  createFolder: (projectId: string, input: { name: string }) =>
    request<ThreadFolder>(`/projects/${projectId}/folders`, { method: "POST", body: JSON.stringify(input) }),
  renameFolder: (id: string, input: { name: string }) =>
    request<ThreadFolder>(`/folders/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteFolder: (id: string) => request<void>(`/folders/${id}`, { method: "DELETE" }),

  listFlows: () => request<FlowConfig[]>("/flows"),
  createFlow: (input: NewFlowConfig) =>
    request<FlowConfig>("/flows", { method: "POST", body: JSON.stringify(input) }),
  updateFlow: (id: string, input: NewFlowConfig) =>
    request<FlowConfig>(`/flows/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteFlow: (id: string) => request<void>(`/flows/${id}`, { method: "DELETE" }),
}
