import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCoAgentStateRender } from "@copilotkit/react-core"
import {
  AssistantMessage as DefaultAssistantMessage,
  CopilotChat,
  UserMessage as DefaultUserMessage,
  type AssistantMessageProps,
  type UserMessageProps,
} from "@copilotkit/react-ui"
import {
  type AgentRunRecord,
  type AgentRunState,
  type FlowConfig,
  type ProductDesignPersona,
  type Project,
  type RunArtifact,
  type SessionConfig,
  type Thread,
} from "@shared/types"
import { FolderTree } from "lucide-react"
import { AgentRunTimeline } from "@/components/agent-run-timeline"
import { Composer } from "@/components/composer"
import { GitHeaderControl } from "@/components/git-header-control"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { qk } from "@/lib/queries"
import { cn } from "@/lib/utils"

interface RunConfig {
  flowId: string | null
  session: SessionConfig | null
}

interface ChatPanelProps {
  project: Project
  thread: Thread
  flows: FlowConfig[]
  flowId: string | null
  session: SessionConfig | null
  workspaceOpen: boolean
  onToggleWorkspace: () => void
  onRenameThread: (id: string, title: string) => Promise<void>
  onChangeRun: (next: RunConfig) => void
  onManageFlows: () => void
  onArtifactsLanded: (artifacts: RunArtifact[]) => void
  persona: ProductDesignPersona
  onPersonaChange: (persona: ProductDesignPersona) => void
  prefill: string | null
  onPrefillConsumed: () => void
}

export function ChatPanel({
  project,
  thread,
  flows,
  flowId,
  session,
  workspaceOpen,
  onToggleWorkspace,
  onRenameThread,
  onChangeRun,
  onManageFlows,
  onArtifactsLanded,
  persona,
  onPersonaChange,
  prefill,
  onPrefillConsumed,
}: ChatPanelProps) {
  const queryClient = useQueryClient()
  const headerRef = useRef<HTMLElement | null>(null)
  const headerActionsRef = useRef<HTMLDivElement | null>(null)
  const fullActionsWidth = useRef(0)
  const [compactGit, setCompactGit] = useState(false)

  // Runs whose state streamed live this session render via useCoAgentStateRender;
  // skip them when rehydrating persisted runs so they don't show twice.
  const liveRunIds = useRef(new Set<string>())

  // Render the orchestrator run timeline inline in the chat as generative UI.
  useCoAgentStateRender<AgentRunState>({
    name: "mrrawbot",
    render: ({ state, status }) => {
      if (state?.runId) liveRunIds.current.add(state.runId)
      return state?.steps?.length ? (
        <AgentRunTimelineWithChangeRefresh state={state} status={status} onComplete={handleRunComplete} />
      ) : null
    },
  })

  // Runs whose completion side effects (query refresh, design auto-open)
  // already fired; the state renderer re-renders freely after completion.
  const completedRunIds = useRef(new Set<string>())

  function handleRunComplete(state: AgentRunState) {
    if (completedRunIds.current.has(state.runId)) return
    completedRunIds.current.add(state.runId)
    void queryClient.invalidateQueries({ queryKey: qk.threadChanges(state.threadId) })
    // Refresh both visible thread list variants after the run so a post-run
    // generated title appears immediately in the sidebar.
    void queryClient.invalidateQueries({ queryKey: qk.threads(project.id, false) })
    void queryClient.invalidateQueries({ queryKey: qk.threads(project.id, true) })
    void queryClient.invalidateQueries({ queryKey: ["runs", state.threadId] })
    void queryClient.invalidateQueries({ queryKey: ["messages", state.threadId] })
    // Old persisted runs carry `designs` (pre-artifacts); coalesce.
    const artifacts: RunArtifact[] =
      state.artifacts ?? state.designs?.map((d) => ({ kind: "prototype" as const, ...d })) ?? []
    if (artifacts.length > 0) {
      void queryClient.invalidateQueries({ queryKey: qk.artifacts(project.id) })
      onArtifactsLanded(artifacts)
    }
  }

  // Chat history itself is hydrated by the CopilotKit connect stream (the
  // server runner replays it from SQLite); this query only anchors persisted
  // run timelines to their surrounding messages.
  const history = useQuery({
    queryKey: ["messages", thread.id],
    queryFn: () => api.messages(thread.id),
    staleTime: Infinity,
  })

  // Rehydrate persisted agent executions so past run timelines show in history.
  // Completed runs anchor to their assistant message; interrupted/failed runs
  // (no assistant message) anchor after the user message that started them.
  const runs = useQuery({
    queryKey: ["runs", thread.id],
    queryFn: () => api.runs(thread.id),
    staleTime: Infinity,
  })
  const { runsByAssistant, runsByUser } = useMemo(() => {
    const runsByAssistant = new Map<string, AgentRunRecord[]>()
    const runsByUser = new Map<string, AgentRunRecord[]>()
    const userMessages = (history.data ?? []).filter((m) => m.role === "user")
    for (const run of [...(runs.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (run.messageId) {
        runsByAssistant.set(run.messageId, [...(runsByAssistant.get(run.messageId) ?? []), run])
        continue
      }
      const anchor = [...userMessages].reverse().find((m) => m.createdAt <= run.createdAt)
      if (anchor) runsByUser.set(anchor.id, [...(runsByUser.get(anchor.id) ?? []), run])
    }
    return { runsByAssistant, runsByUser }
  }, [runs.data, history.data])

  const persistedTimelines = (messageId: string | undefined, map: Map<string, AgentRunRecord[]>) =>
    (messageId ? (map.get(messageId) ?? []) : [])
      .filter((run) => !liveRunIds.current.has(run.id))
      .map((run) => <AgentRunTimeline key={run.id} state={run.state} status="complete" />)

  useLayoutEffect(() => {
    const header = headerRef.current
    const actions = headerActionsRef.current
    if (!header || !actions) return

    // Compact the git control only when the expanded control would squeeze the
    // (truncatable) title below a fixed minimum — never based on how long the
    // title text happens to be. The hysteresis band keeps the flip from
    // oscillating around the threshold.
    const TITLE_MIN_WIDTH = 160
    const HYSTERESIS = 56

    const updateGitFit = () => {
      const headerStyle = getComputedStyle(header)
      const contentWidth =
        header.clientWidth - parseFloat(headerStyle.paddingLeft) - parseFloat(headerStyle.paddingRight)
      const gap = parseFloat(headerStyle.columnGap || headerStyle.gap || "0")
      const actionsWidth = actions.scrollWidth

      if (!compactGit) fullActionsWidth.current = actionsWidth

      const expandedActionsWidth = fullActionsWidth.current || actionsWidth
      const titleSpace = contentWidth - expandedActionsWidth - gap
      setCompactGit((current) =>
        current ? titleSpace < TITLE_MIN_WIDTH + HYSTERESIS : titleSpace < TITLE_MIN_WIDTH,
      )
    }

    updateGitFit()

    const observer = new ResizeObserver(updateGitFit)
    observer.observe(header)
    observer.observe(actions)
    return () => observer.disconnect()
  }, [compactGit])

  return (
    <div className="flex h-full flex-col">
      <header ref={headerRef} className="mrr-header flex min-h-12 min-w-0 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
        <EditableTitle title={thread.title} onSave={(t) => onRenameThread(thread.id, t)} />

        <div ref={headerActionsRef} className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
          <GitHeaderControl project={project} thread={thread} compact={compactGit} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={workspaceOpen ? "Hide workspace panel" : "Show workspace panel"}
                aria-pressed={workspaceOpen}
                onClick={onToggleWorkspace}
              >
                <FolderTree className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{workspaceOpen ? "Hide workspace" : "Show workspace"}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className={cn("relative min-h-0 flex-1")}>
        <CopilotChat
          className="mrr-chat h-full"
          labels={{
            placeholder:
              thread.kind === "product-design" ? "Describe the product or feature…" : "Describe a coding task…",
          }}
          AssistantMessage={(props: AssistantMessageProps) => (
            <>
              {persistedTimelines(props.message?.id, runsByAssistant)}
              <DefaultAssistantMessage {...props} />
            </>
          )}
          UserMessage={(props: UserMessageProps) => (
            <>
              <DefaultUserMessage {...props} />
              {persistedTimelines(props.message?.id, runsByUser)}
            </>
          )}
          Input={(props: {
            inProgress: boolean
            onSend: (message: string) => void | Promise<unknown>
            onStop?: () => void
            chatReady?: boolean
          }) => (
            <Composer
              thread={thread}
              flows={flows}
              flowId={flowId}
              session={session}
              onChangeRun={onChangeRun}
              onManageFlows={onManageFlows}
              persona={persona}
              onPersonaChange={onPersonaChange}
              prefill={prefill}
              onPrefillConsumed={onPrefillConsumed}
              inProgress={props.inProgress}
              onSend={props.onSend}
              onStop={props.onStop}
              chatReady={props.chatReady}
            />
          )}
        />
      </div>
    </div>
  )
}

function AgentRunTimelineWithChangeRefresh({
  state,
  status,
  onComplete,
}: {
  state: AgentRunState
  status: "inProgress" | "complete"
  onComplete: (state: AgentRunState) => void
}) {
  useEffect(() => {
    if (status === "complete") onComplete(state)
  }, [onComplete, state, status])

  return <AgentRunTimeline state={state} status={status} />
}

function EditableTitle({
  title,
  onSave,
}: {
  title: string
  onSave: (title: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)

  useEffect(() => {
    if (!editing) setValue(title)
  }, [editing, title])

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") {
            setValue(title)
            setEditing(false)
          }
        }}
        className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
      />
    )
  }

  // Size the click target to the title text — only the title itself should be
  // clickable, not the whole empty stretch of header next to it.
  return (
    <button
      onClick={() => setEditing(true)}
      className="min-w-0 max-w-full shrink truncate rounded-md px-2 py-1 text-left text-sm font-medium transition-colors hover:bg-accent"
      title="Click to rename"
    >
      {title}
    </button>
  )

  async function commit() {
    setEditing(false)
    const next = value.trim()
    if (next && next !== title) await onSave(next)
    else setValue(title)
  }
}
