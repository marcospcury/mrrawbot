import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { CopilotKit } from "@copilotkit/react-core"
import "@copilotkit/react-ui/styles.css"
import type {
  Project,
  ProductDesignPersona,
  RunArtifact,
  SessionConfig,
  Thread,
  ThreadKind,
} from "@shared/types"
import { AgentsDialog } from "@/components/agents-dialog"
import { AppSidebar } from "@/components/app-sidebar"
import { ChatPanel } from "@/components/chat-panel"
import { FlowsDialog } from "@/components/flows-dialog"
import { RepoPickerDialog } from "@/components/repo-picker-dialog"
import { SettingsPage } from "@/components/settings-page"
import { WelcomeScreen } from "@/components/welcome-screen"

// The workspace panel drags in CodeMirror, the merge view, and the full
// language catalog — and it's closed by default. Load it only when opened.
const WorkspacePanel = lazy(() =>
  import("@/components/workspace-panel").then((m) => ({ default: m.WorkspacePanel })),
)
import type { WorkspaceTab } from "@/components/workspace-panel"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { usePersisted } from "@/hooks/use-persisted"
import { useFlows, useProjectMutations, useProjects, useThreadMutations, useThreads } from "@/lib/queries"

interface RunConfig {
  flowId: string | null
  session: SessionConfig | null
}

export type DialogKind = "repos" | "agents" | "flows" | null

export default function App() {
  const projects = useProjects()
  const flows = useFlows()

  const [activeProjectId, setActiveProjectId] = usePersisted<string | null>("mrr.activeProject", null)
  const [threadByProject, setThreadByProject] = usePersisted<Record<string, string>>("mrr.activeThread", {})
  const [workspaceOpen, setWorkspaceOpen] = usePersisted("mrr.workspace.open", false)
  const [workspaceSize, setWorkspaceSize] = usePersisted("mrr.workspace.size", 32)
  const [workspaceTab, setWorkspaceTab] = usePersisted<WorkspaceTab>("mrr.workspace.tab", "files")
  // Workspace shown full-size in the main container, temporarily replacing the
  // chat view (the chat stays mounted underneath so live runs keep streaming).
  const [workspaceInMain, setWorkspaceInMain] = useState(false)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [openDesignSlug, setOpenDesignSlug] = useState<string | null>(null)
  const [persona, setPersona] = useState<ProductDesignPersona>("auto")
  const [composerPrefill, setComposerPrefill] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = usePersisted("mrr.sidebar.width", 272)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const activeProject = useMemo(() => {
    const list = projects.data ?? []
    return list.find((p) => p.id === activeProjectId) ?? list[0] ?? null
  }, [projects.data, activeProjectId])

  useEffect(() => {
    if (activeProject && activeProject.id !== activeProjectId) setActiveProjectId(activeProject.id)
  }, [activeProject, activeProjectId, setActiveProjectId])

  const threads = useThreads(activeProject?.id ?? null, includeArchived)
  const threadMutations = useThreadMutations(activeProject?.id ?? null)
  const projectMutations = useProjectMutations()

  const activeThreadId = activeProject ? (threadByProject[activeProject.id] ?? null) : null
  const activeThread = useMemo(
    () => threads.data?.find((t) => t.id === activeThreadId) ?? null,
    [threads.data, activeThreadId],
  )

  // Live run config (flow vs. single-agent quick run) forwarded to the agent.
  // Seeded from the thread when it changes; edited instantly in the chat header.
  const [runDraft, setRunDraft] = useState<RunConfig | null>(null)
  useEffect(() => {
    setRunDraft(activeThread ? { flowId: activeThread.flowId, session: activeThread.session } : null)
    setPersona("auto")
  }, [activeThread?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function changeRun(next: RunConfig) {
    if (!activeThread) return
    setRunDraft(next)
    void threadMutations.update.mutateAsync({ id: activeThread.id, flowId: next.flowId, session: next.session })
  }

  // Auto-select the most recent thread when none is active.
  useEffect(() => {
    if (!activeProject || activeThread) return
    const firstOpen = (threads.data ?? []).find((t) => !t.archived)
    if (firstOpen) selectThread(firstOpen.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads.data, activeProject?.id])

  function selectProject(id: string) {
    setActiveProjectId(id)
    setOpenDesignSlug(null)
    setSelectedFilePath(null)
    setWorkspaceInMain(false)
  }

  // A run just landed artifacts: surface them like a delivered artifact —
  // open the workspace on the Artifacts tab, and open the prototype browser
  // when the newest artifact is a prototype.
  function artifactsLanded(artifacts: RunArtifact[]) {
    const newest = artifacts[artifacts.length - 1]
    if (!newest) return
    setWorkspaceOpen(true)
    setWorkspaceTab("design")
    setOpenDesignSlug(newest.kind === "prototype" ? newest.slug : null)
  }

  // "Start build thread" from a prompt artifact: new build thread with the
  // prompt prefilled in the composer (not auto-sent).
  async function startBuildThread(promptText: string) {
    if (!activeProject) return
    const thread = await threadMutations.create.mutateAsync({ kind: "build" })
    selectThread(thread.id)
    setComposerPrefill(promptText)
  }

  function selectThread(id: string) {
    if (activeProject) setThreadByProject((prev) => ({ ...prev, [activeProject.id]: id }))
  }

  async function newThread(kind: ThreadKind = "build") {
    if (!activeProject) return
    const thread = await threadMutations.create.mutateAsync({ kind })
    selectThread(thread.id)
  }

  async function renameThread(id: string, title: string) {
    await threadMutations.update.mutateAsync({ id, title })
  }

  async function archiveThread(thread: Thread, archived: boolean) {
    await threadMutations.update.mutateAsync({ id: thread.id, archived })
    if (archived && thread.id === activeThreadId) clearActiveThread()
  }

  async function deleteThread(thread: Thread) {
    await threadMutations.remove.mutateAsync(thread.id)
    if (thread.id === activeThreadId) clearActiveThread()
  }

  function clearActiveThread() {
    if (!activeProject) return
    setThreadByProject((prev) => {
      const next = { ...prev }
      delete next[activeProject.id]
      return next
    })
  }

  async function deleteProject(project: Project) {
    await projectMutations.remove.mutateAsync(project.id)
    setThreadByProject((prev) => {
      const next = { ...prev }
      delete next[project.id]
      return next
    })
    if (activeProjectId === project.id) {
      const remaining = (projects.data ?? []).filter((p) => p.id !== project.id)
      setActiveProjectId(remaining[0]?.id ?? null)
    }
  }

  const hasProjects = (projects.data?.length ?? 0) > 0

  return (
    <SidebarProvider
      open={settingsOpen ? true : undefined}
      onOpenChange={settingsOpen ? () => undefined : undefined}
      style={{ "--sidebar-width": settingsOpen ? "16rem" : `${sidebarWidth}px` } as React.CSSProperties}
      className={settingsOpen ? "h-svh overflow-hidden max-md:flex-col" : undefined}
    >
      {settingsOpen ? (
        <SettingsPage onBack={() => setSettingsOpen(false)} />
      ) : (
        <>
          <AppSidebar
            onResize={setSidebarWidth}
            projects={projects.data ?? []}
            activeProject={activeProject}
            onSelectProject={selectProject}
            onDeleteProject={deleteProject}
            threads={threads.data ?? []}
            threadsLoading={threads.isLoading}
            activeThreadId={activeThread?.id ?? null}
            includeArchived={includeArchived}
            onToggleArchived={() => setIncludeArchived((v) => !v)}
            onSelectThread={selectThread}
            onNewThread={newThread}
            onRenameThread={renameThread}
            onArchiveThread={archiveThread}
            onDeleteThread={deleteThread}
            onOpenRepos={() => setDialog("repos")}
            onOpenAgents={() => setDialog("agents")}
            onOpenFlows={() => setDialog("flows")}
            onOpenSettings={() => {
              setDialog(null)
              setSettingsOpen(true)
            }}
          />

          <SidebarInset className="h-svh overflow-hidden">
            {activeProject && activeThread ? (
              <CopilotKit
                key={activeThread.id}
                runtimeUrl="/api/copilotkit"
                agent="mrrawbot"
                threadId={activeThread.id}
                properties={{
                  flowId: runDraft?.flowId ?? null,
                  session: runDraft?.session ?? null,
                  persona: activeThread.kind === "product-design" ? persona : undefined,
                }}
                showDevConsole={false}
              >
                <div className="relative h-full">
                  <ResizablePanelGroup
                    orientation="horizontal"
                    className="h-full"
                    // Persist the split only when the user releases the drag — a
                    // per-frame setState here re-renders the whole chat + workspace
                    // tree mid-drag and makes resizing feel janky.
                    onLayoutChanged={(layout, meta) => {
                      const size = layout["workspace"]
                      if (meta.isUserInteraction && typeof size === "number") setWorkspaceSize(Math.round(size))
                    }}
                  >
                    {/* react-resizable-panels v4 treats bare numbers as pixels — sizes must be "%" strings. */}
                    <ResizablePanel id="chat" minSize="25%" defaultSize={workspaceOpen ? `${100 - workspaceSize}%` : "100%"}>
                      <ChatPanel
                        project={activeProject}
                        thread={activeThread}
                        flows={flows.data ?? []}
                        flowId={runDraft?.flowId ?? null}
                        session={runDraft?.session ?? null}
                        workspaceOpen={workspaceOpen}
                        onToggleWorkspace={() => setWorkspaceOpen(!workspaceOpen)}
                        onRenameThread={renameThread}
                        onChangeRun={changeRun}
                        onManageFlows={() => setDialog("flows")}
                        onArtifactsLanded={artifactsLanded}
                        persona={persona}
                        onPersonaChange={setPersona}
                        prefill={composerPrefill}
                        onPrefillConsumed={() => setComposerPrefill(null)}
                      />
                    </ResizablePanel>
                    {workspaceOpen && !workspaceInMain && (
                      <>
                        <ResizableHandle />
                        <ResizablePanel id="workspace" minSize="24%" maxSize="75%" defaultSize={`${workspaceSize}%`}>
                          <Suspense fallback={null}>
                            <WorkspacePanel
                              projectId={activeProject.id}
                              threadId={activeThread.id}
                              tab={workspaceTab}
                              onTabChange={setWorkspaceTab}
                              selectedPath={selectedFilePath}
                              onSelectPath={setSelectedFilePath}
                              onOpenInMain={() => setWorkspaceInMain(true)}
                              openDesignSlug={openDesignSlug}
                              onOpenDesign={setOpenDesignSlug}
                              onSelectThread={selectThread}
                              onStartBuildThread={startBuildThread}
                            />
                          </Suspense>
                        </ResizablePanel>
                      </>
                    )}
                  </ResizablePanelGroup>
                  {workspaceInMain && (
                    <div className="absolute inset-0 z-10 bg-background">
                      <Suspense fallback={null}>
                        <WorkspacePanel
                          projectId={activeProject.id}
                          threadId={activeThread.id}
                          tab={workspaceTab}
                          onTabChange={setWorkspaceTab}
                          location="main"
                          selectedPath={selectedFilePath}
                          onSelectPath={setSelectedFilePath}
                          onExitMain={() => setWorkspaceInMain(false)}
                          openDesignSlug={openDesignSlug}
                          onOpenDesign={setOpenDesignSlug}
                          onSelectThread={(id) => {
                            setWorkspaceInMain(false)
                            selectThread(id)
                          }}
                          onStartBuildThread={(prompt) => {
                            setWorkspaceInMain(false)
                            void startBuildThread(prompt)
                          }}
                        />
                      </Suspense>
                    </div>
                  )}
                </div>
              </CopilotKit>
            ) : (
              <WelcomeScreen
                hasProjects={hasProjects}
                projectName={activeProject?.name ?? null}
                onAddRepo={() => setDialog("repos")}
                onNewThread={activeProject ? () => newThread("build") : undefined}
              />
            )}
          </SidebarInset>
        </>
      )}

      <RepoPickerDialog
        open={dialog === "repos"}
        onOpenChange={(o) => setDialog(o ? "repos" : null)}
        onCreated={(project) => {
          setActiveProjectId(project.id)
          setDialog(null)
        }}
      />
      <AgentsDialog open={dialog === "agents"} onOpenChange={(o) => setDialog(o ? "agents" : null)} />
      <FlowsDialog open={dialog === "flows"} onOpenChange={(o) => setDialog(o ? "flows" : null)} />
    </SidebarProvider>
  )
}
