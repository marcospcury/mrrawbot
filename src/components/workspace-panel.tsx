import { useEffect } from "react"
import { AnglesLeft, Chat, DiagramTree, PenTool2 } from "reicon-react"
import { GitCompareArrows } from "lucide-react"
import { ChangesView } from "@/components/changes-view"
import { ArtifactsTab } from "@/components/artifacts-tab"
import { FileTree } from "@/components/file-tree"
import { FileViewer } from "@/components/file-viewer"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { usePersisted } from "@/hooks/use-persisted"
import { useProjectArtifacts, useProjects } from "@/lib/queries"
import { cn } from "@/lib/utils"

// "design" is the persisted tab id for the Artifacts tab (kept for back-compat
// with saved mrr.workspace.tab values).
export type WorkspaceTab = "files" | "changes" | "design"

interface WorkspacePanelProps {
  projectId: string
  threadId: string
  tab: WorkspaceTab
  onTabChange: (tab: WorkspaceTab) => void
  /** "side" is the right panel; "main" temporarily replaces the chat view. */
  location?: "side" | "main"
  selectedPath: string | null
  onSelectPath: (path: string | null) => void
  onOpenInMain?: () => void
  onExitMain?: () => void
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
  location = "side",
  selectedPath,
  onSelectPath,
  onOpenInMain,
  onExitMain,
  openDesignSlug,
  onOpenDesign,
  onSelectThread,
  onStartBuildThread,
}: WorkspacePanelProps) {
  const projects = useProjects()
  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const hasRepository = Boolean(project?.repoPath.trim())
  const isMain = location === "main"

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

  return (
    <aside
      className={cn("flex h-full min-w-0 flex-col bg-background", !isMain && "border-l")}
      data-project-id={projectId}
      data-thread-id={threadId}
    >
      {!hasRepository ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          No repository linked
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as WorkspaceTab)} className="flex h-full min-h-0 flex-col gap-0">
          <header className="mrr-header flex min-h-12 shrink-0 items-center gap-2 border-b px-3">
            {/* The base TabsList sets h-9 via a group-data variant that outranks a plain h-8. */}
            <TabsList className="h-8!">
              <TabsTrigger value="files" className="gap-1.5">
                <DiagramTree className="size-4" />
                Files
              </TabsTrigger>
              <TabsTrigger value="changes" className="gap-1.5">
                <GitCompareArrows className="size-4" />
                Changes
              </TabsTrigger>
              <TabsTrigger value="design" className="relative gap-1.5">
                <PenTool2 className="size-4" />
                Artifacts
                {hasNewArtifacts && (
                  <span
                    className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary"
                    aria-label="New artifacts"
                  />
                )}
              </TabsTrigger>
            </TabsList>
            <div className="ml-auto flex items-center gap-1">
              {isMain ? (
                <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onExitMain}>
                  <Chat className="size-3.5" />
                  Back to chat
                </Button>
              ) : (
                onOpenInMain && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        aria-label="Open in main view"
                        onClick={onOpenInMain}
                      >
                        <AnglesLeft className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Open in main view</TooltipContent>
                  </Tooltip>
                )
              )}
            </div>
          </header>

          <TabsContent value="files" className="min-h-0 overflow-hidden">
            {selectedPath ? (
              // The narrow side panel stacks tree above viewer; the main view
              // has the width for a proper tree-left / viewer-right layout.
              <ResizablePanelGroup orientation={isMain ? "horizontal" : "vertical"} className="h-full min-h-0">
                {/* react-resizable-panels v4 treats bare numbers as pixels — sizes must be "%" strings. */}
                <ResizablePanel id="file-tree" minSize="15%" defaultSize={isMain ? "26%" : "40%"}>
                  <FileTree projectId={projectId} selectedPath={selectedPath} onSelectFile={onSelectPath} />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel id="file-viewer" minSize="30%" defaultSize={isMain ? "74%" : "60%"}>
                  <FileViewer projectId={projectId} path={selectedPath} onClose={() => onSelectPath(null)} />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <FileTree projectId={projectId} selectedPath={selectedPath} onSelectFile={onSelectPath} />
            )}
          </TabsContent>

          <TabsContent value="changes" className="min-h-0 overflow-hidden">
            {isMain ? (
              <ChangesView threadId={threadId} layout="split" />
            ) : (
              <ScrollArea className="h-full">
                <ChangesView threadId={threadId} />
              </ScrollArea>
            )}
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
    </aside>
  )
}
