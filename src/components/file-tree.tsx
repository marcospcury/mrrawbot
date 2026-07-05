import { useState, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import type { FileTreeEntry } from "@shared/types"
import { useAppearance } from "@/components/appearance-provider"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileIcon } from "@/lib/file-icons"
import { useProjectFiles } from "@/lib/queries"
import { cn } from "@/lib/utils"

interface FileTreeProps {
  projectId: string
  selectedPath: string | null
  onSelectFile: (path: string) => void
}

export function FileTree({ projectId, selectedPath, onSelectFile }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]))

  const toggleDirectory = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        <DirectoryChildren
          projectId={projectId}
          dir=""
          level={0}
          expanded={expanded}
          selectedPath={selectedPath}
          onToggleDirectory={toggleDirectory}
          onSelectFile={onSelectFile}
        />
      </div>
    </ScrollArea>
  )
}

function DirectoryChildren({
  projectId,
  dir,
  level,
  expanded,
  selectedPath,
  onToggleDirectory,
  onSelectFile,
}: {
  projectId: string
  dir: string
  level: number
  expanded: Set<string>
  selectedPath: string | null
  onToggleDirectory: (path: string) => void
  onSelectFile: (path: string) => void
}) {
  const files = useProjectFiles(projectId, dir, expanded.has(dir))

  if (files.isLoading) return <TreeStatus level={level}>Loading…</TreeStatus>
  if (files.isError) return <TreeStatus level={level}>Unable to load folder</TreeStatus>
  if (!files.data?.length) {
    return level === 0 ? <TreeStatus level={level}>No files found</TreeStatus> : null
  }

  return (
    <div className="space-y-0.5">
      {files.data.map((entry) => (
        <TreeRow
          key={entry.path}
          entry={entry}
          level={level}
          expanded={expanded}
          selectedPath={selectedPath}
          onToggleDirectory={onToggleDirectory}
          onSelectFile={onSelectFile}
          projectId={projectId}
        />
      ))}
    </div>
  )
}

function TreeRow({
  entry,
  level,
  expanded,
  selectedPath,
  onToggleDirectory,
  onSelectFile,
  projectId,
}: {
  entry: FileTreeEntry
  level: number
  expanded: Set<string>
  selectedPath: string | null
  onToggleDirectory: (path: string) => void
  onSelectFile: (path: string) => void
  projectId: string
}) {
  const { fileIconTheme } = useAppearance()
  const isDirectory = entry.type === "dir"
  const isOpen = isDirectory && expanded.has(entry.path)
  const isSelected = entry.type === "file" && entry.path === selectedPath

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden",
          isSelected && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        )}
        style={{ paddingLeft: `${level * 0.75 + 0.5}rem` }}
        aria-expanded={isDirectory ? isOpen : undefined}
        title={entry.path}
        onClick={() => {
          if (isDirectory) onToggleDirectory(entry.path)
          else onSelectFile(entry.path)
        }}
      >
        {isDirectory ? (
          <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <FileIcon name={entry.name} type={entry.type} open={isOpen} theme={fileIconTheme} />
        <span className="truncate">{entry.name}</span>
      </button>
      {isOpen && (
        <DirectoryChildren
          projectId={projectId}
          dir={entry.path}
          level={level + 1}
          expanded={expanded}
          selectedPath={selectedPath}
          onToggleDirectory={onToggleDirectory}
          onSelectFile={onSelectFile}
        />
      )}
    </div>
  )
}

function TreeStatus({ level, children }: { level: number; children: ReactNode }) {
  return (
    <p
      className="py-1.5 pr-2 text-sm text-muted-foreground"
      style={{ paddingLeft: `${level * 0.75 + 0.5}rem` }}
    >
      {children}
    </p>
  )
}
