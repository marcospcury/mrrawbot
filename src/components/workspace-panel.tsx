import { useEffect, useState } from "react"
import { FolderTree, GitCompareArrows, PenTool } from "lucide-react"
import { ChangesView } from "@/components/changes-view"
import { ArtifactsTab } from "@/components/artifacts-tab"
import { FileTree } from "@/components/file-tree"
import { FileViewer } from "@/components/file-viewer"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePersisted } from "@/hooks/use-persisted"
import { useProjectArtifacts, useProjects } from "@/lib/queries"

// "design" is the persisted tab id for the Artifacts tab (kept for back-compat
// with saved mrr.workspace.tab values).
export type WorkspaceTab = "files" | "changes" | "design"

interface WorkspacePanelProps {
  projectId: string
  threadId: string
  tab: WorkspaceTab
  onTabChange: (tab: WorkspaceTab) => void
  openDesignSlug: string | null
  onOpenDesign: (slug: string | null) => void
  onSelectThread?: (threadId: string) => void
  onStartBuildThread?: (promptText: string) => void
}

export function WorkspacePanel({
  projectId,
  threadId,
  tab,
  onTabChange,
  openDesignSlug,
  onOpenDesign,
  onSelectThread,
  onStartBuildThread,
}: WorkspacePanelProps) {
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const hasRepository = Boolean(project?.repoPath.trim())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [viewerExpanded, setViewerExpanded] = useState(false)

  // A dot on the Artifacts tab when artifacts landed since it was last viewed.
  const artifacts = useProjectArtifacts(hasRepository ? projectId : null)
  const [designsSeen, setDesignsSeen] = usePersisted<Record<string, string>>("mrr.designs.seen", {})
  const latestArtifactAt = artifacts.data?.[0]?.updatedAt ?? null
  const hasNewArtifacts = tab !== "design" && !!latestArtifactAt && latestArtifactAt > (designsSeen[projectId] ?? "")
  useEffect(() => {
    if (tab !== "design" || !latestArtifactAt) return
    if ((designsSeen[projectId] ?? "") < latestArtifactAt)
      setDesignsSeen({ ...designsSeen, [projectId]: latestArtifactAt })
  }, [tab, latestArtifactAt, projectId, designsSeen, setDesignsSeen])

  useEffect(() => {
    setSelectedPath(null)
    setViewerExpanded(false)
  }, [projectId])

  return (
    <aside
      className="flex h-full min-w-0 flex-col border-l bg-background"
      data-project-id={projectId}
      data-thread-id={threadId}
    >
      {!hasRepository ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          No repository linked
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as WorkspaceTab)} className="flex h-full min-h-0 flex-col gap-0">
          <header className="mrr-header flex min-h-12 shrink-0 items-center border-b px-3">
            <TabsList className="h-8">
              <TabsTrigger value="files" className="gap-1.5">
                <FolderTree className="size-4" />
                Files
              </TabsTrigger>
              <TabsTrigger value="changes" className="gap-1.5">
                <GitCompareArrows className="size-4" />
                Changes
              </TabsTrigger>
              <TabsTrigger value="design" className="relative gap-1.5">
                <PenTool className="size-4" />
                Artifacts
                {hasNewArtifacts && (
                  <span
                    className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary"
                    aria-label="New artifacts"
                  />
                )}
              </TabsTrigger>
            </TabsList>
          </header>

          <TabsContent value="files" className="min-h-0 overflow-hidden">
            {selectedPath ? (
              <ResizablePanelGroup orientation="vertical" className="h-full min-h-0">
                {/* react-resizable-panels v4 treats bare numbers as pixels — sizes must be "%" strings. */}
                <ResizablePanel id="file-tree" minSize="20%" defaultSize="40%">
                  <FileTree projectId={projectId} selectedPath={selectedPath} onSelectFile={setSelectedPath} />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel id="file-viewer" minSize="30%" defaultSize="60%">
                  <FileViewer
                    projectId={projectId}
                    path={selectedPath}
                    onClose={() => setSelectedPath(null)}
                    onExpand={() => setViewerExpanded(true)}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <FileTree projectId={projectId} selectedPath={selectedPath} onSelectFile={setSelectedPath} />
            )}
          </TabsContent>

          <TabsContent value="changes" className="min-h-0">
            <ScrollArea className="h-full">
              <ChangesView threadId={threadId} />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="design" className="min-h-0 overflow-hidden">
            <ArtifactsTab
              projectId={projectId}
              openSlug={openDesignSlug}
              onOpenSlug={onOpenDesign}
              onSelectThread={onSelectThread}
              onStartBuildThread={onStartBuildThread}
            />
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={viewerExpanded} onOpenChange={setViewerExpanded}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[88vh] w-[min(96vw,1400px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">File viewer</DialogTitle>
          <DialogDescription className="sr-only">{selectedPath ?? ""}</DialogDescription>
          {viewerExpanded && (
            <FileViewer projectId={projectId} path={selectedPath} onClose={() => setViewerExpanded(false)} />
          )}
        </DialogContent>
      </Dialog>
    </aside>
  )
}
