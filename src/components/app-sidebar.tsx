import { useState } from "react"
import {
  Archive,
  ArchiveRestore,
  Bot,
  ChevronsUpDown,
  FolderGit2,
  GitBranch,
  MessageSquarePlus,
  MonitorSmartphone,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Sun,
  Trash2,
  Workflow,
} from "lucide-react"
import type { Project, Thread } from "@shared/types"
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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { relativeTime } from "@/lib/format"
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
  onNewThread: () => void
  onRenameThread: (id: string, title: string) => Promise<void>
  onArchiveThread: (thread: Thread, archived: boolean) => Promise<void>
  onDeleteThread: (thread: Thread) => Promise<void>
  onOpenRepos: () => void
  onOpenAgents: () => void
  onOpenFlows: () => void
  onOpenSettings: () => void
  onResize: (width: number) => void
}

export function AppSidebar(props: AppSidebarProps) {
  const { activeProject, threads, threadsLoading, includeArchived } = props
  const [renaming, setRenaming] = useState<Thread | null>(null)
  const [deleting, setDeleting] = useState<Thread | null>(null)
  const [deletingProject, setDeletingProject] = useState<Project | null>(null)

  const openThreads = threads.filter((t) => !t.archived)
  const archivedThreads = threads.filter((t) => t.archived)

  return (
    <Sidebar collapsible="icon" className="border-r group-data-[collapsible=icon]:border-transparent">
      <SidebarHeader className="mrr-header gap-2 p-2">
        <ProjectSwitcher {...props} onRequestDelete={setDeletingProject} />
        <Button
          variant="outline"
          className="h-9 justify-start gap-2 group-data-[collapsible=icon]:hidden"
          onClick={props.onNewThread}
          disabled={!activeProject}
        >
          <MessageSquarePlus className="size-4" />
          New thread
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Threads</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {threadsLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <SidebarMenuItem key={i}>
                    <SidebarMenuSkeleton />
                  </SidebarMenuItem>
                ))
              ) : openThreads.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  {activeProject ? "No threads yet." : "Add a repository to begin."}
                </p>
              ) : (
                openThreads.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    active={thread.id === props.activeThreadId}
                    onSelect={() => props.onSelectThread(thread.id)}
                    onRename={() => setRenaming(thread)}
                    onArchive={() => props.onArchiveThread(thread, true)}
                    onDelete={() => setDeleting(thread)}
                  />
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {includeArchived && archivedThreads.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Archived</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {archivedThreads.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    active={thread.id === props.activeThreadId}
                    archived
                    onSelect={() => props.onSelectThread(thread.id)}
                    onRename={() => setRenaming(thread)}
                    onArchive={() => props.onArchiveThread(thread, false)}
                    onDelete={() => setDeleting(thread)}
                  />
                ))}
              </SidebarMenu>
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
      <SidebarResizeHandle onResize={props.onResize} />
    </Sidebar>
  )
}

function SidebarResizeHandle({ onResize }: { onResize: (width: number) => void }) {
  const { state } = useSidebar()
  if (state !== "expanded") return null
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      className="absolute inset-y-0 -right-0.5 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-border active:bg-border"
      onMouseDown={(e) => {
        e.preventDefault()
        // Drive the CSS var directly during the drag (and disable the sidebar's
        // width transition via data-sidebar-resizing) so it tracks the cursor;
        // commit to persisted state on mouseup.
        const wrapper = e.currentTarget.closest<HTMLElement>('[data-slot="sidebar-wrapper"]')
        if (!wrapper) return
        wrapper.setAttribute("data-sidebar-resizing", "")
        let width = 0
        const onMove = (ev: MouseEvent) => {
          width = Math.min(420, Math.max(200, ev.clientX))
          wrapper.style.setProperty("--sidebar-width", `${width}px`)
        }
        const onUp = () => {
          document.removeEventListener("mousemove", onMove)
          document.removeEventListener("mouseup", onUp)
          wrapper.removeAttribute("data-sidebar-resizing")
          if (width) onResize(width)
        }
        document.addEventListener("mousemove", onMove)
        document.addEventListener("mouseup", onUp)
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

function ThreadRow({
  thread,
  active,
  archived,
  onSelect,
  onRename,
  onArchive,
  onDelete,
}: {
  thread: Thread
  active: boolean
  archived?: boolean
  onSelect: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} onClick={onSelect} className="pr-8">
        <GitBranch className={cn("size-4 shrink-0", archived && "opacity-50")} />
        <span className={cn("truncate", archived && "text-muted-foreground")}>{thread.title}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover>
            <MoreHorizontal className="size-4" />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-44">
          <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
            {relativeTime(thread.updatedAt)}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={onRename} className="gap-2">
            <Pencil className="size-4" />
            Rename
          </DropdownMenuItem>
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
