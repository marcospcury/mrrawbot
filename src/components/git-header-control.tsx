import { useEffect, useState } from "react"
import type {
  GitHubMergeMethod,
  GitHubStatusRow,
  Project,
  ProjectGitStatus,
  ProjectPullRequestDetails,
  Thread,
} from "@shared/types"
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Loader2,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useProjectGitMutations, useProjectGitStatus, useProjectPullRequest } from "@/lib/queries"
import { cn } from "@/lib/utils"

interface GitHeaderControlProps {
  project: Project
  thread: Thread
}

export function GitHeaderControl({ project, thread }: GitHeaderControlProps) {
  const [open, setOpen] = useState(false)
  const statusQuery = useProjectGitStatus(project.id)
  const status = statusQuery.data

  if (!status?.isGit) return null

  const onDefaultBranch = !!status.branch && status.branch === status.defaultBranch
  const action = onDefaultBranch
    ? "Create branch"
    : status.remote?.isGitHub
      ? status.pullRequest
        ? `PR #${status.pullRequest.number}`
        : "Open PR"
      : "Git"

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 max-w-[18rem] gap-2 rounded-full px-3"
        onClick={() => setOpen(true)}
      >
        <GitBranch className="size-3.5" />
        <span className="truncate font-mono text-xs">{status.branch ?? "detached"}</span>
        {status.dirty && <CircleDot className="size-3 fill-amber-500 text-amber-500" aria-label="Dirty worktree" />}
        <span className="hidden text-xs text-muted-foreground sm:inline">{action}</span>
      </Button>
      <GitProjectDialog
        open={open}
        onOpenChange={setOpen}
        project={project}
        thread={thread}
        status={status}
        statusRefreshing={statusQuery.isFetching}
      />
    </>
  )
}

function GitProjectDialog({
  open,
  onOpenChange,
  project,
  thread,
  status,
  statusRefreshing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  thread: Thread
  status: ProjectGitStatus
  statusRefreshing: boolean
}) {
  const onDefaultBranch = !!status.branch && status.branch === status.defaultBranch
  const prQuery = useProjectPullRequest(project.id, open && !!status.remote?.isGitHub && !onDefaultBranch)
  const mutations = useProjectGitMutations(project.id)
  const [branchName, setBranchName] = useState(() => suggestedBranch(thread.title))
  const [prTitle, setPrTitle] = useState(() => titleFromBranch(status.branch ?? thread.title))
  const [prBody, setPrBody] = useState("")
  const [mergeMethod, setMergeMethod] = useState<GitHubMergeMethod>("squash")
  const [mergeConfirmed, setMergeConfirmed] = useState(false)

  useEffect(() => {
    if (open && onDefaultBranch) setBranchName(suggestedBranch(thread.title))
  }, [open, onDefaultBranch, thread.title])

  useEffect(() => {
    if (open && status.branch && !onDefaultBranch) setPrTitle(titleFromBranch(status.branch))
  }, [open, onDefaultBranch, status.branch])

  useEffect(() => {
    const next = prQuery.data?.merge?.defaultMethod
    if (next) setMergeMethod(next)
  }, [prQuery.data?.merge?.defaultMethod])

  const details = prQuery.data
  const pr = details?.pullRequest ?? status.pullRequest
  const merge = details?.merge ?? null
  const canCreatePr = !!status.remote?.isGitHub && !onDefaultBranch && !pr

  async function createBranch() {
    try {
      await mutations.createBranch.mutateAsync({ name: branchName })
      toast.success("Branch created")
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  async function createPullRequest() {
    try {
      await mutations.createPullRequest.mutateAsync({
        title: prTitle.trim() || undefined,
        body: prBody.trim() || undefined,
      })
      toast.success("Pull request opened")
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  async function mergePullRequest() {
    if (!pr || !merge?.expectedHeadSha) return
    try {
      await mutations.mergePullRequest.mutateAsync({
        number: pr.number,
        confirm: mergeConfirmed,
        method: mergeMethod,
        expectedHeadSha: merge.expectedHeadSha,
      })
      toast.success("Pull request merged")
      setMergeConfirmed(false)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="size-5" />
            Git and GitHub
          </DialogTitle>
          <DialogDescription>{project.name} uses live state from the selected project folder.</DialogDescription>
        </DialogHeader>

        <section className="grid gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {status.branch ?? "detached"}
            </Badge>
            {status.defaultBranch && <span className="text-sm text-muted-foreground">default: {status.defaultBranch}</span>}
            {status.dirty && <Badge className="bg-amber-500 text-white">dirty</Badge>}
            {statusRefreshing && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            <span>Ahead {status.ahead} / behind {status.behind}</span>
            <span>Upstream {status.upstream ?? "none"}</span>
            <span>Remote {status.remote?.url ?? "none"}</span>
            <span>Head {status.headSha ? status.headSha.slice(0, 12) : "unknown"}</span>
          </div>
        </section>

        {onDefaultBranch ? (
          <section className="grid gap-3 rounded-lg border p-4">
            <div>
              <h3 className="text-sm font-medium">Create branch</h3>
              <p className="text-sm text-muted-foreground">Create and switch to a feature branch from the default branch.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="branch-name">Branch name</Label>
              <Input id="branch-name" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
            </div>
            <div>
              <Button onClick={createBranch} disabled={mutations.createBranch.isPending}>
                {mutations.createBranch.isPending && <Loader2 className="size-4 animate-spin" />}
                Create branch
              </Button>
            </div>
          </section>
        ) : (
          <PullRequestSection
            status={status}
            details={details}
            loading={prQuery.isLoading}
            canCreatePr={canCreatePr}
            prTitle={prTitle}
            prBody={prBody}
            onPrTitleChange={setPrTitle}
            onPrBodyChange={setPrBody}
            onCreatePullRequest={createPullRequest}
            creatingPullRequest={mutations.createPullRequest.isPending}
          />
        )}

        {details?.pullRequest && <PullRequestDetails details={details} />}

        {pr && merge && (
          <section className="grid gap-3 rounded-lg border p-4">
            <div>
              <h3 className="text-sm font-medium">Merge</h3>
              <p className="text-sm text-muted-foreground">
                {merge.canMerge ? "Ready to merge with the expected head SHA guard." : merge.blockedReason ?? "Merge is blocked."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={mergeMethod} onValueChange={(value) => setMergeMethod(value as GitHubMergeMethod)}>
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {merge.allowedMethods.map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mergeConfirmed}
                  onChange={(event) => setMergeConfirmed(event.target.checked)}
                />
                Confirm merge
              </label>
            </div>
            <div>
              <Button
                variant="default"
                onClick={mergePullRequest}
                disabled={!merge.canMerge || !mergeConfirmed || mutations.mergePullRequest.isPending}
              >
                {mutations.mergePullRequest.isPending && <Loader2 className="size-4 animate-spin" />}
                Merge PR
              </Button>
            </div>
          </section>
        )}

        {status.github?.error && <p className="text-sm text-destructive">{status.github.error}</p>}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

function PullRequestSection({
  status,
  details,
  loading,
  canCreatePr,
  prTitle,
  prBody,
  onPrTitleChange,
  onPrBodyChange,
  onCreatePullRequest,
  creatingPullRequest,
}: {
  status: ProjectGitStatus
  details: ProjectPullRequestDetails | undefined
  loading: boolean
  canCreatePr: boolean
  prTitle: string
  prBody: string
  onPrTitleChange: (value: string) => void
  onPrBodyChange: (value: string) => void
  onCreatePullRequest: () => void
  creatingPullRequest: boolean
}) {
  if (!status.remote?.isGitHub) {
    return (
      <section className="rounded-lg border p-4 text-sm text-muted-foreground">
        This Git remote is not a supported GitHub.com remote, so PR controls are disabled.
      </section>
    )
  }

  if (loading) {
    return (
      <section className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading pull request state…
      </section>
    )
  }

  const pr = details?.pullRequest ?? status.pullRequest
  if (pr) {
    return (
      <section className="grid gap-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <GitPullRequest className="size-4" />
          <h3 className="text-sm font-medium">PR #{pr.number}</h3>
          <Badge variant={pr.draft ? "secondary" : "outline"}>{pr.draft ? "draft" : pr.state}</Badge>
        </div>
        <a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium hover:underline">
          {pr.title}
          <ExternalLink className="size-3" />
        </a>
        <p className="text-sm text-muted-foreground">
          {pr.headRefName} → {pr.baseRefName} · {pr.headSha.slice(0, 12)}
        </p>
      </section>
    )
  }

  if (!canCreatePr) return null

  return (
    <section className="grid gap-3 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-medium">Open PR</h3>
        <p className="text-sm text-muted-foreground">This pushes the current branch to origin and creates a ready-to-review PR.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pr-title">Title</Label>
        <Input id="pr-title" value={prTitle} onChange={(e) => onPrTitleChange(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pr-body">Body</Label>
        <Textarea
          id="pr-body"
          value={prBody}
          onChange={(e) => onPrBodyChange(e.target.value)}
          placeholder="Leave empty to use the local PR template when present."
        />
      </div>
      <div>
        <Button onClick={onCreatePullRequest} disabled={creatingPullRequest}>
          {creatingPullRequest && <Loader2 className="size-4 animate-spin" />}
          Open PR
        </Button>
      </div>
    </section>
  )
}

function PullRequestDetails({ details }: { details: ProjectPullRequestDetails }) {
  return (
    <div className="grid gap-4">
      <section className="grid gap-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">CI statuses</h3>
        {details.checks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No checks or commit statuses found.</p>
        ) : (
          <div className="grid gap-2">
            {details.checks.map((row) => (
              <StatusRow key={row.id} row={row} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Reviews</h3>
        {details.reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reviews yet.</p>
        ) : (
          <div className="grid gap-2">
            {details.reviews.map((review) => (
              <div key={review.id} className="rounded-md bg-muted/40 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{review.state}</Badge>
                  <span className="font-medium">{review.author ?? "unknown"}</span>
                  {review.submittedAt && <span className="text-muted-foreground">{new Date(review.submittedAt).toLocaleString()}</span>}
                </div>
                {review.body && <p className="mt-2 line-clamp-3 text-muted-foreground">{review.body}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Comments</h3>
        {details.comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <div className="grid gap-2">
            {details.comments.map((comment) => (
              <a
                key={`${comment.type}-${comment.id}`}
                href={comment.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-muted/40 p-3 text-sm hover:bg-muted"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{comment.type}</Badge>
                  <span className="font-medium">{comment.author ?? "unknown"}</span>
                  {comment.path && <span className="text-muted-foreground">{comment.path}{comment.line ? `:${comment.line}` : ""}</span>}
                </div>
                <p className="mt-2 line-clamp-3 text-muted-foreground">{comment.body}</p>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function StatusRow({ row }: { row: GitHubStatusRow }) {
  const tone = statusTone(row)
  const Icon = tone === "success" ? CheckCircle2 : tone === "failure" ? XCircle : tone === "pending" ? Loader2 : AlertCircle
  return (
    <a
      href={row.url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 rounded-md bg-muted/40 p-3 text-sm hover:bg-muted"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon className={cn("size-4 shrink-0", tone === "pending" && "animate-spin", toneClass(tone))} />
        <span className="truncate font-medium">{row.name}</span>
        <Badge variant="outline">{row.type}</Badge>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{row.details ?? row.status}</span>
    </a>
  )
}

function statusTone(row: GitHubStatusRow): "success" | "failure" | "pending" | "neutral" {
  const value = (row.conclusion ?? row.status).toLowerCase()
  if (["success", "completed"].includes(value)) return "success"
  if (["failure", "error", "cancelled", "timed_out", "action_required"].includes(value)) return "failure"
  if (["pending", "queued", "in_progress", "requested", "waiting"].includes(value)) return "pending"
  return "neutral"
}

function toneClass(tone: "success" | "failure" | "pending" | "neutral") {
  if (tone === "success") return "text-emerald-600"
  if (tone === "failure") return "text-destructive"
  if (tone === "pending") return "text-amber-500"
  return "text-muted-foreground"
}

function suggestedBranch(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return `feat/${slug || "new-branch"}`
}

function titleFromBranch(branch: string) {
  const cleaned = branch
    .replace(/^[a-z]+\//i, "")
    .replace(/[-_]+/g, " ")
    .trim()
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : branch
}
