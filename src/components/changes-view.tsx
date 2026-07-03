import { useMemo, useState } from "react"
import { unifiedMergeView } from "@codemirror/merge"
import type { Extension } from "@codemirror/state"
import CodeMirror from "@uiw/react-codemirror"
import { Loader2, TriangleAlert } from "lucide-react"
import type { ThreadChange, ThreadChangeStatus } from "@shared/types"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { createEditorTheme } from "@/lib/codemirror-theme"
import { useThreadChanges } from "@/lib/queries"
import { cn } from "@/lib/utils"

interface ChangesViewProps {
  threadId: string
}

export function ChangesView({ threadId }: ChangesViewProps) {
  // Changes are persisted only when a run finishes, and run completion already
  // invalidates this query (chat-panel's refreshThreadChanges) — the interval
  // is just a slow safety net, not the delivery mechanism. The payload carries
  // full before/after file contents, so polling it fast is expensive.
  const changes = useThreadChanges(threadId, 30_000)
  const groups = useMemo(() => groupChangesByRun(changes.data ?? []), [changes.data])

  if (changes.isLoading) return <ChangesStatus icon={<Loader2 className="size-4 animate-spin" />}>Loading changes…</ChangesStatus>
  if (changes.isError) return <ChangesStatus icon={<TriangleAlert className="size-4" />}>Unable to load changes</ChangesStatus>
  if (groups.length === 0) return <ChangesStatus>No changes in this thread yet</ChangesStatus>

  return (
    <div className="p-2">
      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.runId} className="overflow-hidden rounded-lg border bg-card/40">
            <header className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">Run</span>{" "}
              <span className="font-mono">{group.runId ?? "unknown"}</span>
            </header>
            <div className="divide-y">
              {group.changes.map((change) => (
                <ChangeRow key={change.id} change={change} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function ChangeRow({ change }: { change: ThreadChange }) {
  const [open, setOpen] = useState(false)
  const meta = changeStatusMeta(change.changeStatus)

  return (
    <div>
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className={cn("flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold", meta.className)}
          title={meta.label}
        >
          {meta.glyph}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={change.filePath}>
          {change.filePath}
        </span>
        <ChangeBadges change={change} />
      </button>
      {open && <InlineDiff change={change} />}
    </div>
  )
}

function ChangeBadges({ change }: { change: ThreadChange }) {
  const badges: string[] = []
  if (change.beforeMissing) badges.push("previous content unavailable")
  if (change.binary) badges.push("binary")
  if (change.truncated) badges.push("truncated")

  if (badges.length === 0) return null

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {badges.map((badge) => (
        <Badge key={badge} variant="outline" className="h-5 px-1.5 text-[10px]">
          {badge}
        </Badge>
      ))}
    </span>
  )
}

function InlineDiff({ change }: { change: ThreadChange }) {
  const { resolvedTheme } = useTheme()
  const editorTheme = useMemo(() => createEditorTheme(resolvedTheme === "dark"), [resolvedTheme])
  const diff = useMemo(() => createDiff(change), [change])
  const extensions = useMemo<Extension[]>(
    () => [
      unifiedMergeView({
        original: diff.original,
        mergeControls: false,
        gutter: true,
        highlightChanges: true,
        collapseUnchanged: { margin: 3, minSize: 8 },
      }),
    ],
    [diff.original],
  )

  if (change.binary) {
    return <DiffStatus>Binary file not shown</DiffStatus>
  }

  return (
    <div className="border-t bg-background">
      {diff.note ? <div className="border-b px-3 py-2 text-xs text-muted-foreground">{diff.note}</div> : null}
      <CodeMirror
        key={`${resolvedTheme}:${change.id}:${change.createdAt}`}
        value={diff.modified}
        maxHeight="28rem"
        className="max-h-[28rem] overflow-hidden text-xs [&_.cm-editor]:max-h-[28rem] [&_.cm-scroller]:overflow-auto"
        basicSetup={{ lineNumbers: true }}
        readOnly
        editable={false}
        theme={editorTheme}
        extensions={extensions}
      />
    </div>
  )
}

function ChangesStatus({ children, icon }: { children: string; icon?: React.ReactNode }) {
  return (
    <div className="flex min-h-48 items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      {icon}
      {children}
    </div>
  )
}

function DiffStatus({ children }: { children: string }) {
  return <div className="border-t p-3 text-sm text-muted-foreground">{children}</div>
}

function groupChangesByRun(changes: ThreadChange[]) {
  const groups = new Map<string, { runId: string | null; createdAt: string; changes: ThreadChange[] }>()
  for (const change of changes) {
    const key = change.runId ?? "unknown"
    const existing = groups.get(key)
    if (existing) {
      existing.changes.push(change)
      if (change.createdAt > existing.createdAt) existing.createdAt = change.createdAt
    } else {
      groups.set(key, { runId: change.runId, createdAt: change.createdAt, changes: [change] })
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function changeStatusMeta(status: ThreadChangeStatus) {
  switch (status) {
    case "added":
      return { label: "Added", glyph: "+", className: "bg-emerald-500/15 text-emerald-400" }
    case "deleted":
      return { label: "Deleted", glyph: "−", className: "bg-destructive/15 text-destructive" }
    case "modified":
      return { label: "Modified", glyph: "~", className: "bg-[color-mix(in_oklch,var(--chart-4)_18%,transparent)] text-[var(--chart-4)]" }
  }
}

function createDiff(change: ThreadChange) {
  if (change.beforeMissing) {
    return {
      original: "",
      modified: change.afterContent ?? "",
      note: "previous content unavailable; showing new content only",
    }
  }
  if (change.changeStatus === "deleted") {
    return {
      original: change.beforeContent ?? "",
      modified: "",
      note: "file deleted; showing removed content",
    }
  }
  return {
    original: change.beforeContent ?? "",
    modified: change.afterContent ?? "",
    note: change.truncated ? "Diff may be incomplete because captured content was truncated." : null,
  }
}
