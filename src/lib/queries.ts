import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { GitHubMergeMethod, NewAgentConfig, NewFlowConfig, SessionConfig } from "@shared/types"
import { api } from "./api"

export const qk = {
  info: ["info"] as const,
  repos: ["repos"] as const,
  providers: ["providers"] as const,
  providerConfig: ["provider-config"] as const,
  models: ["models"] as const,
  projects: ["projects"] as const,
  projectGitStatus: (projectId: string) => ["project-git-status", projectId] as const,
  projectPullRequest: (projectId: string) => ["project-pull-request", projectId] as const,
  projectFiles: (projectId: string, dir: string) => ["project-files", projectId, dir] as const,
  projectFile: (projectId: string, path: string) => ["project-file", projectId, path] as const,
  threads: (projectId: string, includeArchived: boolean) => ["threads", projectId, includeArchived] as const,
  messages: (threadId: string) => ["messages", threadId] as const,
  threadChanges: (threadId: string) => ["thread-changes", threadId] as const,
  agents: ["agents"] as const,
  flows: ["flows"] as const,
}

export function useInfo() {
  return useQuery({ queryKey: qk.info, queryFn: api.info, staleTime: Infinity })
}

export function useRepos(enabled = true) {
  return useQuery({ queryKey: qk.repos, queryFn: () => api.repos(false), enabled })
}

export function useProviders() {
  return useQuery({ queryKey: qk.providers, queryFn: api.providers, refetchInterval: 60_000 })
}

export function useProviderConfig(enabled = true) {
  return useQuery({ queryKey: qk.providerConfig, queryFn: api.providerConfig, enabled })
}

export function useUpdateProviderConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.updateProviderConfig,
    onSuccess: (config) => {
      qc.setQueryData(qk.providerConfig, config)
      void qc.invalidateQueries({ queryKey: qk.providers })
      void qc.invalidateQueries({ queryKey: qk.models })
    },
  })
}

export function useModels() {
  return useQuery({ queryKey: qk.models, queryFn: api.models, refetchInterval: 60_000 })
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: api.listProjects })
}

export function useProjectFiles(projectId: string | null, dir = "", enabled = true) {
  return useQuery({
    queryKey: qk.projectFiles(projectId ?? "", dir),
    queryFn: () => api.getProjectFiles(projectId!, dir),
    enabled: enabled && !!projectId,
  })
}

export function useProjectGitStatus(projectId: string | null) {
  return useQuery({
    queryKey: qk.projectGitStatus(projectId ?? ""),
    queryFn: () => api.getProjectGitStatus(projectId!),
    enabled: !!projectId,
    refetchInterval: 30_000,
  })
}

export function useProjectPullRequest(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.projectPullRequest(projectId ?? ""),
    queryFn: () => api.getProjectPullRequest(projectId!),
    enabled: enabled && !!projectId,
  })
}

export function useProjectFile(projectId: string | null, path: string | null) {
  return useQuery({
    queryKey: qk.projectFile(projectId ?? "", path ?? ""),
    queryFn: () => api.getProjectFile(projectId!, path!),
    enabled: !!projectId && !!path,
  })
}

export function useThreads(projectId: string | null, includeArchived: boolean) {
  return useQuery({
    queryKey: qk.threads(projectId ?? "", includeArchived),
    queryFn: () => api.listThreads(projectId!, includeArchived),
    enabled: !!projectId,
  })
}

export function useThreadChanges(threadId: string | null, refetchInterval: number | false = false) {
  return useQuery({
    queryKey: qk.threadChanges(threadId ?? ""),
    queryFn: () => api.getThreadChanges(threadId!),
    enabled: !!threadId,
    refetchInterval,
  })
}

export function useAgents() {
  return useQuery({ queryKey: qk.agents, queryFn: api.listAgents })
}

export function useFlows() {
  return useQuery({ queryKey: qk.flows, queryFn: api.listFlows })
}

export function useProjectMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.projects })
  return {
    create: useMutation({
      mutationFn: api.createProject,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string; name: string; defaultFlowId: string | null }) =>
        api.updateProject(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: api.deleteProject,
      onSuccess: invalidate,
    }),
  }
}

export function useProjectGitMutations(projectId: string | null) {
  const qc = useQueryClient()
  const invalidate = () => {
    if (!projectId) return
    qc.invalidateQueries({ queryKey: qk.projectGitStatus(projectId) })
    qc.invalidateQueries({ queryKey: qk.projectPullRequest(projectId) })
  }
  return {
    createBranch: useMutation({
      mutationFn: (input: { name: string }) => api.createProjectBranch(projectId!, input),
      onSuccess: invalidate,
    }),
    commitChanges: useMutation({
      mutationFn: (input: { message: string; branchName?: string | null }) => api.commitProjectChanges(projectId!, input),
      onSuccess: invalidate,
    }),
    pushBranch: useMutation({
      mutationFn: () => api.pushProjectBranch(projectId!),
      onSuccess: invalidate,
    }),
    checkoutDefaultBranch: useMutation({
      mutationFn: () => api.checkoutProjectDefaultBranch(projectId!),
      onSuccess: invalidate,
    }),
    pullDefaultBranch: useMutation({
      mutationFn: () => api.pullProjectDefaultBranch(projectId!),
      onSuccess: invalidate,
    }),
    deleteBranch: useMutation({
      mutationFn: (input: { name: string }) => api.deleteProjectBranch(projectId!, input),
      onSuccess: invalidate,
    }),
    createPullRequest: useMutation({
      mutationFn: (input: { title?: string; body?: string; base?: string }) =>
        api.createProjectPullRequest(projectId!, input),
      onSuccess: invalidate,
    }),
    mergePullRequest: useMutation({
      mutationFn: (input: { number: number; confirm: boolean; method: GitHubMergeMethod; expectedHeadSha: string }) =>
        api.mergeProjectPullRequest(projectId!, input.number, {
          confirm: input.confirm,
          method: input.method,
          expectedHeadSha: input.expectedHeadSha,
        }),
      onSuccess: invalidate,
    }),
  }
}

export function useThreadMutations(projectId: string | null) {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["threads", projectId ?? ""] })
  }
  return {
    create: useMutation({
      mutationFn: (input: { title?: string; flowId?: string | null; session?: SessionConfig | null }) =>
        api.createThread(projectId!, input),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        ...input
      }: {
        id: string
        title?: string
        archived?: boolean
        flowId?: string | null
        session?: SessionConfig | null
      }) => api.updateThread(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: api.deleteThread,
      onSuccess: invalidate,
    }),
  }
}

export function useAgentMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.agents })
  return {
    create: useMutation({ mutationFn: (input: NewAgentConfig) => api.createAgent(input), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string } & NewAgentConfig) => api.updateAgent(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deleteAgent, onSuccess: invalidate }),
  }
}

export function useFlowMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.flows })
  return {
    create: useMutation({ mutationFn: (input: NewFlowConfig) => api.createFlow(input), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string } & NewFlowConfig) => api.updateFlow(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deleteFlow, onSuccess: invalidate }),
  }
}
