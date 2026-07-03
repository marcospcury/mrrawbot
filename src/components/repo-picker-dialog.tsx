import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Check, FolderGit2, GitBranch, GitFork, Loader2, RefreshCw } from "lucide-react"
import type { GitRepo, Project } from "@shared/types"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { qk, useFlows, useProjects, useProjectMutations, useRepos } from "@/lib/queries"
import { relativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

export function RepoPickerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: Project) => void
}) {
  const repos = useRepos(open)
  const projects = useProjects()
  const flows = useFlows()
  const { create } = useProjectMutations()
  const qc = useQueryClient()
  const [creatingPath, setCreatingPath] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [manualPath, setManualPath] = useState("")
  const [addingManual, setAddingManual] = useState(false)

  const existingByPath = useMemo(
    () => new Map((projects.data ?? []).map((p) => [p.repoPath, p])),
    [projects.data],
  )

  const defaultFlowId = useMemo(() => {
    const list = flows.data ?? []
    return list.find((f) => f.name === "Claude Code")?.id ?? list[0]?.id ?? null
  }, [flows.data])

  const { github, others } = useMemo(() => {
    const list = repos.data ?? []
    return {
      github: list.filter((r) => r.isGitHub),
      others: list.filter((r) => !r.isGitHub),
    }
  }, [repos.data])

  async function choose(repo: GitRepo) {
    setCreatingPath(repo.path)
    try {
      const project = await create.mutateAsync({
        repoPath: repo.path,
        name: repo.name,
        defaultFlowId,
      })
      toast.success(`Opened ${project.name}`)
      onCreated(project)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreatingPath(null)
    }
  }

  async function addManual() {
    const repoPath = manualPath.trim()
    if (!repoPath || addingManual) return
    setAddingManual(true)
    try {
      const project = await create.mutateAsync({ repoPath, defaultFlowId })
      toast.success(`Opened ${project.name}`)
      setManualPath("")
      onCreated(project)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAddingManual(false)
    }
  }

  async function refresh() {
    setRefreshing(true)
    try {
      await api.repos(true)
      await qc.invalidateQueries({ queryKey: qk.repos })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>Add a repository</DialogTitle>
              <DialogDescription className="mt-0.5">
                Pick a git repository tracked on this machine.
              </DialogDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing} className="gap-1.5">
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
              Rescan
            </Button>
          </div>
        </DialogHeader>
        <Command className="[&_[cmdk-input-wrapper]]:border-b">
          <CommandInput placeholder="Search repositories…" />
          <CommandList className="max-h-[55vh]">
            {repos.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Scanning your repositories…
              </div>
            ) : (
              <>
                <CommandEmpty>No repositories found in your configured roots.</CommandEmpty>
                {github.length > 0 && (
                  <CommandGroup heading="GitHub">
                    {github.map((repo) => (
                      <RepoItem
                        key={repo.path}
                        repo={repo}
                        added={existingByPath.has(repo.path)}
                        creating={creatingPath === repo.path}
                        onSelect={() => choose(repo)}
                      />
                    ))}
                  </CommandGroup>
                )}
                {others.length > 0 && (
                  <CommandGroup heading="Other git repositories">
                    {others.map((repo) => (
                      <RepoItem
                        key={repo.path}
                        repo={repo}
                        added={existingByPath.has(repo.path)}
                        creating={creatingPath === repo.path}
                        onSelect={() => choose(repo)}
                      />
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
        <div className="flex items-center gap-2 border-t px-4 py-3">
          <Input
            value={manualPath}
            placeholder="Or paste a folder path…  e.g. ~/Documents/my-repo"
            className="h-8"
            onChange={(e) => setManualPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addManual()
              }
            }}
          />
          <Button
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={addingManual || !manualPath.trim()}
            onClick={addManual}
          >
            {addingManual && <Loader2 className="size-3.5 animate-spin" />}
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RepoItem({
  repo,
  added,
  creating,
  onSelect,
}: {
  repo: GitRepo
  added: boolean
  creating: boolean
  onSelect: () => void
}) {
  const subtitle = repo.isGitHub ? `${repo.githubOwner}/${repo.githubRepo}` : repo.path
  return (
    <CommandItem
      value={`${repo.name} ${repo.path} ${repo.githubOwner ?? ""}/${repo.githubRepo ?? ""}`}
      onSelect={onSelect}
      className="gap-3 py-2"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground">
        {repo.isGitHub ? <GitFork className="size-4" /> : <FolderGit2 className="size-4" />}
      </div>
      <div className="grid min-w-0 flex-1">
        <span className="truncate text-sm font-medium">{repo.name}</span>
        <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {repo.branch && (
          <span className="hidden items-center gap-1 sm:inline-flex">
            <GitBranch className="size-3" />
            {repo.branch}
          </span>
        )}
        {repo.dirty && <span className="size-1.5 rounded-full bg-amber-400" title="Uncommitted changes" />}
        {repo.lastCommitAt && <span className="hidden md:inline">{relativeTime(repo.lastCommitAt)}</span>}
        {creating ? (
          <Loader2 className="size-4 animate-spin" />
        ) : added ? (
          <Check className="size-4 text-emerald-400" />
        ) : null}
      </div>
    </CommandItem>
  )
}
