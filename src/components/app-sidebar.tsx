import { useState } from "react"
import {
  Archive,
  ArchiveRestore,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Folder,
  FolderGit2,
  FolderInput,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  MessageSquare,
  MessageSquarePlus,
  MonitorSmartphone,
  Moon,
  MoreHorizontal,
  Pencil,
  PenTool,
  Plus,
  Settings,
  Sun,
  Trash2,
  Workflow,
} from "lucide-react"
import type { Project, ProjectBranchStatus, Thread, ThreadFolder, ThreadKind } from "@shared/types"
import { useTheme } from "@/components/theme-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { usePersisted } from "@/hooks/use-persisted"
import { relativeTime } from "@/lib/format"
import { useFolderMutations, useFolders, useProjectBranches, useThreadMutations } from "@/lib/queries"
import { cn } from "@/lib/utils"

interface AppSidebarProps {
  projects: Project[]
  activeProject: Project | null
  onSelectProject: (id: string) => void
  onDeleteProject: (project: Project) => Promise<void>
  threads: Thread[]
  threadsLoading: boolean
  activeThreadId: string | null
  includeArchived: boolean
  onToggleArchived: () => void
  onSelectThread: (id: string) => void
  onNewThread: (kind: ThreadKind) => void
  onRenameThread: (id: string, title: string) => Promise<void>
  onArchiveThread: (thread: Thread, archived: boolean) => Promise<void>
  onDeleteThread: (thread: Thread) => Promise<void>
  onOpenRepos: () => void
  onOpenAgents: () => void
  onOpenFlows: () => void
  onOpenSettings: () => void
  onResize: (width: number) => void
}

type FolderDialogState = { mode: "create" } | { mode: "rename"; folder: ThreadFolder } | null

export function AppSidebar(props: AppSidebarProps) {
  const { activeProject, threads, threadsLoading, includeArchived } = props
  const [renaming, setRenaming] = useState<Thread | null>(null)
  const [deleting, setDeleting] = useState<Thread | null>(null)
  const [deletingProject, setDeletingProject] = useState<Project | null>(null)
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null)
  const [deletingFolder, setDeletingFolder] = useState<ThreadFolder | null>(null)
  const [collapsedFolders, setCollapsedFolders] = usePersisted<Record<string, boolean>>(
    "mrr.sidebar.folders.collapsed",
    {},
  )

  const folders = useFolders(activeProject?.id ?? null)
  const folderMutations = useFolderMutations(activeProject?.id ?? null)
  const threadMutations = useThreadMutations(activeProject?.id ?? null)
  const branchesQuery = useProjectBranches(activeProject?.id ?? null)
  const branches = branchesQuery.data

  const openThreads = threads.filter((t) => !t.archived)
  const archivedThreads = threads.filter((t) => t.archived)
  const folderList = folders.data ?? []
  const folderIds = new Set(folderList.map((f) => f.id))
  // Threads pointing at a folder that no longer exists fall back to the top level.
  const looseThreads = openThreads.filter((t) => !t.folderId || !folderIds.has(t.folderId))
  const threadsByFolder = new Map<string, Thread[]>()
  for (const thread of openThreads) {
    if (!thread.folderId || !folderIds.has(thread.folderId)) continue
    threadsByFolder.set(thread.folderId, [...(threadsByFolder.get(thread.folderId) ?? []), thread])
  }

  async function moveThreadToFolder(thread: Thread, folderId: string | null) {
    await threadMutations.update.mutateAsync({ id: thread.id, folderId })
  }

  const threadRow = (thread: Thread, archived = false) => (
    <ThreadRow
      key={thread.id}
      thread={thread}
      active={thread.id === props.activeThreadId}
      archived={archived}
      branches={branches}
      folders={folderList}
      onSelect={() => props.onSelectThread(thread.id)}
      onRename={() => setRenaming(thread)}
      onArchive={() => props.onArchiveThread(thread, !archived)}
      onDelete={() => setDeleting(thread)}
      onMoveToFolder={(folderId) => void moveThreadToFolder(thread, folderId)}
    />
  )

  return (
    <Sidebar collapsible="icon" className="border-r group-data-[collapsible=icon]:border-transparent">
      <SidebarHeader className="mrr-header gap-2 p-2">
        <ProjectSwitcher {...props} onRequestDelete={setDeletingProject} />
        <div className="flex gap-1 group-data-[collapsible=icon]:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-9 min-w-0 flex-1 justify-start gap-2"
                disabled={!activeProject}
              >
                <MessageSquarePlus className="size-4" />
                New thread
                <ChevronDown className="ml-auto size-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuItem onClick={() => props.onNewThread("build")} className="gap-2">
                <MessageSquarePlus className="size-4 text-muted-foreground" />
                <span className="grid gap-0.5">
                  <span>Build thread</span>
                  <span className="text-xs text-muted-foreground">Run agents and flows on the repository</span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.onNewThread("product-design")} className="gap-2">
                <PenTool className="size-4 text-muted-foreground" />
                <span className="grid gap-0.5">
                  <span>Product design session</span>
                  <span className="text-xs text-muted-foreground">
                    Discover and design with the Specialist and Designer
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="justify-between pr-0.5">
            Threads
            <button
              type="button"
              aria-label="New folder"
              title="New folder"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-50"
              disabled={!activeProject}
              onClick={() => setFolderDialog({ mode: "create" })}
            >
              <FolderPlus className="size-3.5" />
            </button>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {threadsLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <SidebarMenuItem key={i}>
                    <SidebarMenuSkeleton />
                  </SidebarMenuItem>
                ))
              ) : openThreads.length === 0 && folderList.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  {activeProject ? "No threads yet." : "Add a repository to begin."}
                </p>
              ) : (
                <>
                  {folderList.map((folder) => (
                    <FolderRow
                      key={folder.id}
                      folder={folder}
                      count={(threadsByFolder.get(folder.id) ?? []).length}
                      collapsed={!!collapsedFolders[folder.id]}
                      onToggle={() =>
                        setCollapsedFolders((prev) => ({ ...prev, [folder.id]: !prev[folder.id] }))
                      }
                      onRename={() => setFolderDialog({ mode: "rename", folder })}
                      onDelete={() => setDeletingFolder(folder)}
                    >
                      {(threadsByFolder.get(folder.id) ?? []).map((thread) => threadRow(thread))}
                    </FolderRow>
                  ))}
                  {looseThreads.map((thread) => threadRow(thread))}
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {includeArchived && archivedThreads.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Archived</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{archivedThreads.map((thread) => threadRow(thread, true))}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-1 p-2">
        <button
          onClick={props.onToggleArchived}
          className="rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground group-data-[collapsible=icon]:hidden"
        >
          {includeArchived ? "Hide archived" : `Show archived${archivedThreads.length ? ` (${archivedThreads.length})` : ""}`}
        </button>
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
          <FooterButton icon={Bot} label="Agents" onClick={props.onOpenAgents} />
          <FooterButton icon={Workflow} label="Flows" onClick={props.onOpenFlows} />
          <FooterButton icon={Settings} label="Settings" onClick={props.onOpenSettings} />
          <div className="flex-1 group-data-[collapsible=icon]:hidden" />
          <ThemeToggle />
          <CollapseToggle />
        </div>
      </SidebarFooter>

      <RenameDialog
        thread={renaming}
        onClose={() => setRenaming(null)}
        onRename={props.onRenameThread}
      />
      <DeleteDialog thread={deleting} onClose={() => setDeleting(null)} onDelete={props.onDeleteThread} />
      <DeleteProjectDialog
        project={deletingProject}
        onClose={() => setDeletingProject(null)}
        onDelete={props.onDeleteProject}
      />
      <FolderDialog
        state={folderDialog}
        onClose={() => setFolderDialog(null)}
        onSubmit={async (name) => {
          if (!folderDialog) return
          if (folderDialog.mode === "create") await folderMutations.create.mutateAsync({ name })
          else await folderMutations.rename.mutateAsync({ id: folderDialog.folder.id, name })
        }}
      />
      <DeleteFolderDialog
        folder={deletingFolder}
        onClose={() => setDeletingFolder(null)}
        onDelete={async (folder) => {
          await folderMutations.remove.mutateAsync(folder.id)
        }}
      />
      <SidebarResizeHandle onResize={props.onResize} />
    </Sidebar>
  )
}

function SidebarResizeHandle({ onResize }: { onResize: (width: number) => void }) {
  const { state } = useSidebar()
  if (state !== "expanded") return null
  // app-no-drag: the handle spans the full window height, so its top overlaps
  // the -webkit-app-region:drag header strip — without it, grabbing the handle
  // there starts an OS window drag instead of a resize.
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      className="app-no-drag absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize transition-colors hover:bg-border active:bg-border"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        // Drive the CSS var directly during the drag (and disable the sidebar's
        // width transition via data-sidebar-resizing) so it tracks the cursor;
        // commit to persisted state on release.
        const handle = e.currentTarget
        const wrapper = handle.closest<HTMLElement>('[data-slot="sidebar-wrapper"]')
        if (!wrapper) return
        // Pointer capture keeps the drag tracking even when the cursor crosses
        // drag regions, embedded content, or leaves the window.
        handle.setPointerCapture(e.pointerId)
        wrapper.setAttribute("data-sidebar-resizing", "")
        let width = 0
        const onMove = (ev: PointerEvent) => {
          width = Math.min(420, Math.max(200, ev.clientX))
          wrapper.style.setProperty("--sidebar-width", `${width}px`)
        }
        const onEnd = () => {
          handle.removeEventListener("pointermove", onMove)
          handle.removeEventListener("pointerup", onEnd)
          handle.removeEventListener("pointercancel", onEnd)
          wrapper.removeAttribute("data-sidebar-resizing")
          if (width) onResize(width)
        }
        handle.addEventListener("pointermove", onMove)
        handle.addEventListener("pointerup", onEnd)
        handle.addEventListener("pointercancel", onEnd)
      }}
    />
  )
}

function ProjectSwitcher({
  projects,
  activeProject,
  onSelectProject,
  onOpenRepos,
  onRequestDelete,
}: Pick<AppSidebarProps, "projects" | "activeProject" | "onSelectProject" | "onOpenRepos"> & {
  onRequestDelete: (project: Project) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent border bg-card/40"
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Bot className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{activeProject?.name ?? "mrrawbot"}</span>
            <span className="truncate text-xs text-muted-foreground">
              {activeProject?.repoName ?? "No repository"}
            </span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Repositories</DropdownMenuLabel>
        {projects.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => onSelectProject(p.id)} className="group/proj gap-2 pr-1">
            <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
            <div className="grid min-w-0 flex-1">
              <span className="truncate text-sm">{p.name}</span>
              <span className="truncate text-xs text-muted-foreground">{p.repoPath}</span>
            </div>
            <button
              type="button"
              aria-label={`Remove ${p.name}`}
              title="Remove from list"
              className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover/proj:opacity-100"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                setOpen(false)
                onRequestDelete(p)
              }}
            >
              <Trash2 className="size-4" />
            </button>
          </DropdownMenuItem>
        ))}
        {projects.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={onOpenRepos} className="gap-2">
          <Plus className="size-4" />
          Add repository…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FolderRow({
  folder,
  count,
  collapsed,
  onToggle,
  onRename,
  onDelete,
  children,
}: {
  folder: ThreadFolder
  count: number
  collapsed: boolean
  onToggle: () => void
  onRename: () => void
  onDelete: () => void
  children: React.ReactNode
}) {
  const FolderIcon = collapsed ? Folder : FolderOpen
  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={onToggle} className="pr-8" aria-expanded={!collapsed}>
        <ChevronRight
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !collapsed && "rotate-90")}
        />
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{folder.name}</span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover>
            <MoreHorizontal className="size-4" />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-44">
          <DropdownMenuItem onClick={onRename} className="gap-2">
            <Pencil className="size-4" />
            Rename folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="gap-2 text-destructive focus:text-destructive">
            <Trash2 className="size-4" />
            Delete folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!collapsed && count > 0 && <SidebarMenuSub className="mr-0 pr-0">{children}</SidebarMenuSub>}
    </SidebarMenuItem>
  )
}

interface ThreadGitMeta {
  icon: typeof GitBranch
  className: string
  tooltip: string | null
  isCurrent: boolean
}

/** Icon + color for a thread row based on its linked branch and PR state. */
function threadGitMeta(thread: Thread, branches: ProjectBranchStatus[] | undefined): ThreadGitMeta {
  if (!thread.branchName) {
    return { icon: MessageSquare, className: "text-muted-foreground/70", tooltip: null, isCurrent: false }
  }
  const branch = branches?.find((b) => b.name === thread.branchName)
  const pr = branch?.pullRequest ?? null
  const isCurrent = !!branch?.isCurrent
  const base = thread.branchName
  if (pr?.merged) {
    return { icon: GitMerge, className: "text-purple-500", tooltip: `${base} — PR #${pr.number} merged`, isCurrent }
  }
  if (pr && pr.state === "open") {
    return {
      icon: GitPullRequest,
      className: pr.draft ? "text-muted-foreground" : "text-emerald-500",
      tooltip: `${base} — PR #${pr.number}${pr.draft ? " (draft)" : " open"}`,
      isCurrent,
    }
  }
  if (pr && pr.state === "closed") {
    return {
      icon: GitPullRequestClosed,
      className: "text-red-500",
      tooltip: `${base} — PR #${pr.number} closed`,
      isCurrent,
    }
  }
  if (branch?.exists) {
    return { icon: GitBranch, className: "text-sky-500", tooltip: `${base} — no PR yet`, isCurrent }
  }
  return { icon: GitBranch, className: "text-muted-foreground/70", tooltip: `${base} — branch not found locally`, isCurrent: false }
}

function ThreadRow({
  thread,
  active,
  archived,
  branches,
  folders,
  onSelect,
  onRename,
  onArchive,
  onDelete,
  onMoveToFolder,
}: {
  thread: Thread
  active: boolean
  archived?: boolean
  branches: ProjectBranchStatus[] | undefined
  folders: ThreadFolder[]
  onSelect: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
  onMoveToFolder: (folderId: string | null) => void
}) {
  const git = threadGitMeta(thread, branches)
  const Icon = git.icon
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={onSelect}
        className="pr-8"
        title={git.tooltip ? `${git.tooltip}${git.isCurrent ? " · checked out" : ""}` : undefined}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          <Icon className={cn("size-4", git.className, archived && "opacity-50")} />
          {git.isCurrent && (
            <span
              className="absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
              aria-label="Checked out"
            />
          )}
        </span>
        <span className={cn("truncate", archived && "text-muted-foreground")}>{thread.title}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover>
            <MoreHorizontal className="size-4" />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-48">
          <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
            {relativeTime(thread.updatedAt)}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={onRename} className="gap-2">
            <Pencil className="size-4" />
            Rename
          </DropdownMenuItem>
          {folders.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <FolderInput className="size-4 text-muted-foreground" />
                Move to folder
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {thread.folderId && (
                  <>
                    <DropdownMenuItem onClick={() => onMoveToFolder(null)} className="gap-2">
                      <MessageSquare className="size-4 text-muted-foreground" />
                      No folder
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {folders
                  .filter((f) => f.id !== thread.folderId)
                  .map((f) => (
                    <DropdownMenuItem key={f.id} onClick={() => onMoveToFolder(f.id)} className="gap-2">
                      <Folder className="size-4 text-muted-foreground" />
                      <span className="truncate">{f.name}</span>
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem onClick={onArchive} className="gap-2">
            {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            {archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="gap-2 text-destructive focus:text-destructive">
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

function FolderDialog({
  state,
  onClose,
  onSubmit,
}: {
  state: FolderDialogState
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}) {
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)

  return (
    <Dialog
      open={!!state}
      onOpenChange={(o) => {
        if (!o) onClose()
        else setValue(state?.mode === "rename" ? state.folder.name : "")
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.mode === "rename" ? "Rename folder" : "New folder"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="folder-name">Name</Label>
          <Input
            id="folder-name"
            value={value}
            autoFocus
            placeholder="e.g. Auth revamp"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit()
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !value.trim()}>
            {state?.mode === "rename" ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  async function submit() {
    if (!state || !value.trim()) return
    setBusy(true)
    try {
      await onSubmit(value.trim())
      onClose()
    } finally {
      setBusy(false)
    }
  }
}

function DeleteFolderDialog({
  folder,
  onClose,
  onDelete,
}: {
  folder: ThreadFolder | null
  onClose: () => void
  onDelete: (folder: ThreadFolder) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <AlertDialog open={!!folder} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this folder?</AlertDialogTitle>
          <AlertDialogDescription>
            “{folder?.name}” will be removed. Threads inside it are kept and move back to the top level.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={async (e) => {
              e.preventDefault()
              if (!folder) return
              setBusy(true)
              try {
                await onDelete(folder)
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function RenameDialog({
  thread,
  onClose,
  onRename,
}: {
  thread: Thread | null
  onClose: () => void
  onRename: (id: string, title: string) => Promise<void>
}) {
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)

  return (
    <Dialog
      open={!!thread}
      onOpenChange={(o) => {
        if (!o) onClose()
        else setValue(thread?.title ?? "")
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename thread</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="thread-title">Title</Label>
          <Input
            id="thread-title"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit()
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !value.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  async function submit() {
    if (!thread || !value.trim()) return
    setBusy(true)
    try {
      await onRename(thread.id, value.trim())
      onClose()
    } finally {
      setBusy(false)
    }
  }
}

function DeleteDialog({
  thread,
  onClose,
  onDelete,
}: {
  thread: Thread | null
  onClose: () => void
  onDelete: (thread: Thread) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <AlertDialog open={!!thread} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this thread?</AlertDialogTitle>
          <AlertDialogDescription>
            “{thread?.title}” and its messages will be permanently removed. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={async (e) => {
              e.preventDefault()
              if (!thread) return
              setBusy(true)
              try {
                await onDelete(thread)
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DeleteProjectDialog({
  project,
  onClose,
  onDelete,
}: {
  project: Project | null
  onClose: () => void
  onDelete: (project: Project) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <AlertDialog open={!!project} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this repository?</AlertDialogTitle>
          <AlertDialogDescription>
            “{project?.name}” will be removed from mrrawbot, along with all of its threads, messages, and run
            history. Your files on disk are not touched. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={async (e) => {
              e.preventDefault()
              if (!project) return
              setBusy(true)
              try {
                await onDelete(project)
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function FooterButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Bot
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={onClick}>
          <Icon className="size-4" />
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function CollapseToggle() {
  const { state } = useSidebar()
  const label = state === "expanded" ? "Collapse sidebar" : "Expand sidebar"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarTrigger className="size-8 text-muted-foreground" aria-label={label} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark"
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : MonitorSmartphone
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={() => setTheme(next)}
        >
          <Icon className="size-4" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="capitalize">Theme: {theme}</TooltipContent>
    </Tooltip>
  )
}
