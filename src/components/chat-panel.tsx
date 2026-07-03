import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCoAgentStateRender } from "@copilotkit/react-core"
import {
  AssistantMessage as DefaultAssistantMessage,
  CopilotChat,
  UserMessage as DefaultUserMessage,
  type AssistantMessageProps,
  type UserMessageProps,
} from "@copilotkit/react-ui"
import { type AgentRunRecord, type AgentRunState, type FlowConfig, type Project, type SessionConfig, type Thread } from "@shared/types"
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
}: ChatPanelProps) {
  const queryClient = useQueryClient()

  // Runs whose state streamed live this session render via useCoAgentStateRender;
  // skip them when rehydrating persisted runs so they don't show twice.
  const liveRunIds = useRef(new Set<string>())

  // Render the orchestrator run timeline inline in the chat as generative UI.
  useCoAgentStateRender<AgentRunState>({
    name: "mrrawbot",
    render: ({ state, status }) => {
      if (state?.runId) liveRunIds.current.add(state.runId)
      return state?.steps?.length ? (
        <AgentRunTimelineWithChangeRefresh state={state} status={status} onComplete={refreshThreadChanges} />
      ) : null
    },
  })

  function refreshThreadChanges(threadId: string) {
    void queryClient.invalidateQueries({ queryKey: qk.threadChanges(threadId) })
    // Refresh both visible thread list variants after the run so a post-run
    // generated title appears immediately in the sidebar.
    void queryClient.invalidateQueries({ queryKey: qk.threads(project.id, false) })
    void queryClient.invalidateQueries({ queryKey: qk.threads(project.id, true) })
    void queryClient.invalidateQueries({ queryKey: ["runs", threadId] })
    void queryClient.invalidateQueries({ queryKey: ["messages", threadId] })
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

  return (
    <div className="flex h-full flex-col">
      <header className="mrr-header mrr-thread-header flex min-h-12 min-w-0 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
        <EditableTitle title={thread.title} onSave={(t) => onRenameThread(thread.id, t)} />

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
          <GitHeaderControl project={project} thread={thread} />
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
            placeholder: "Describe a coding task…",
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
              flows={flows}
              flowId={flowId}
              session={session}
              onChangeRun={onChangeRun}
              onManageFlows={onManageFlows}
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
  onComplete: (threadId: string) => void
}) {
  useEffect(() => {
    if (status === "complete") onComplete(state.threadId)
  }, [onComplete, state.runId, state.threadId, status])

  return <AgentRunTimeline state={state} status={status} />
}

function EditableTitle({ title, onSave }: { title: string; onSave: (title: string) => Promise<void> }) {
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

  return (
    <button
      onClick={() => setEditing(true)}
      className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-sm font-medium transition-colors hover:bg-accent"
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
