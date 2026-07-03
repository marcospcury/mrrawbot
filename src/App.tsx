import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { CopilotKit } from "@copilotkit/react-core"
import "@copilotkit/react-ui/styles.css"
import type { Project, SessionConfig, Thread } from "@shared/types"
import { AgentsDialog } from "@/components/agents-dialog"
import { AppSidebar } from "@/components/app-sidebar"
import { ChatPanel } from "@/components/chat-panel"
import { FlowsDialog } from "@/components/flows-dialog"
import { RepoPickerDialog } from "@/components/repo-picker-dialog"
import { SettingsDialog } from "@/components/settings-dialog"
import { WelcomeScreen } from "@/components/welcome-screen"

// The workspace panel drags in CodeMirror, the merge view, and the full
// language catalog — and it's closed by default. Load it only when opened.
const WorkspacePanel = lazy(() =>
  import("@/components/workspace-panel").then((m) => ({ default: m.WorkspacePanel })),
)
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { usePersisted } from "@/hooks/use-persisted"
import { useFlows, useProjectMutations, useProjects, useThreadMutations, useThreads } from "@/lib/queries"

interface RunConfig {
  flowId: string | null
  session: SessionConfig | null
}

export type DialogKind = "repos" | "agents" | "flows" | "settings" | null

export default function App() {
  const projects = useProjects()
  const flows = useFlows()

  const [activeProjectId, setActiveProjectId] = usePersisted<string | null>("mrr.activeProject", null)
  const [threadByProject, setThreadByProject] = usePersisted<Record<string, string>>("mrr.activeThread", {})
  const [workspaceOpen, setWorkspaceOpen] = usePersisted("mrr.workspace.open", false)
  const [workspaceSize, setWorkspaceSize] = usePersisted("mrr.workspace.size", 32)
  const [sidebarWidth, setSidebarWidth] = usePersisted("mrr.sidebar.width", 272)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [dialog, setDialog] = useState<DialogKind>(null)

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
  }

  function selectThread(id: string) {
    if (activeProject) setThreadByProject({ ...threadByProject, [activeProject.id]: id })
  }

  async function newThread() {
    if (!activeProject) return
    const thread = await threadMutations.create.mutateAsync({})
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
    const next = { ...threadByProject }
    delete next[activeProject.id]
    setThreadByProject(next)
  }

  async function deleteProject(project: Project) {
    await projectMutations.remove.mutateAsync(project.id)
    const nextThreads = { ...threadByProject }
    delete nextThreads[project.id]
    setThreadByProject(nextThreads)
    if (activeProjectId === project.id) {
      const remaining = (projects.data ?? []).filter((p) => p.id !== project.id)
      setActiveProjectId(remaining[0]?.id ?? null)
    }
  }

  const hasProjects = (projects.data?.length ?? 0) > 0

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
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
        onOpenSettings={() => setDialog("settings")}
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
            }}
            showDevConsole={false}
          >
            <ResizablePanelGroup orientation="horizontal" className="h-full">
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
                />
              </ResizablePanel>
              {workspaceOpen && (
                <>
                  <ResizableHandle />
                  <ResizablePanel
                    id="workspace"
                    minSize="24%"
                    maxSize="75%"
                    defaultSize={`${workspaceSize}%`}
                    onResize={(size) => setWorkspaceSize(Math.round(size.asPercentage))}
                  >
                    <Suspense fallback={null}>
                      <WorkspacePanel projectId={activeProject.id} threadId={activeThread.id} />
                    </Suspense>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </CopilotKit>
        ) : (
          <WelcomeScreen
            hasProjects={hasProjects}
            projectName={activeProject?.name ?? null}
            onAddRepo={() => setDialog("repos")}
            onNewThread={activeProject ? newThread : undefined}
          />
        )}
      </SidebarInset>

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
      <SettingsDialog open={dialog === "settings"} onOpenChange={(o) => setDialog(o ? "settings" : null)} />
    </SidebarProvider>
  )
}
