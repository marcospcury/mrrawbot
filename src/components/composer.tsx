import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  Settings2,
  Workflow,
  Zap,
} from "lucide-react"
import { useChatContext } from "@copilotkit/react-ui"
import { ROLES, effortLabel, effortsFor, roleName, type Effort, type FlowConfig, type SessionConfig } from "@shared/types"
import { ModelCombobox } from "@/components/model-combobox"
import { ProviderPill } from "@/components/provider-pill"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useRunConfig, type RunConfig } from "@/hooks/use-run-config"
import { cn } from "@/lib/utils"

export function Composer({
  flows,
  flowId,
  session,
  onChangeRun,
  onManageFlows,
  inProgress,
  onSend,
  onStop,
  chatReady = true,
}: {
  flows: FlowConfig[]
  flowId: string | null
  session: SessionConfig | null
  onChangeRun: (next: RunConfig) => void
  onManageFlows: () => void
  inProgress: boolean
  onSend: (message: string) => void | Promise<unknown>
  onStop?: () => void
  chatReady?: boolean
}) {
  const [text, setText] = useState("")
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const chatContext = useChatContext()
  const run = useRunConfig({ flows, flowId, session, onChangeRun })
  const canSend = chatReady && !inProgress && text.trim().length > 0
  const canStop = inProgress
  const sendDisabled = !canSend && !canStop
  const buttonIcon = !chatReady
    ? chatContext.icons.spinnerIcon
    : inProgress
      ? chatContext.icons.stopIcon
      : chatContext.icons.sendIcon
  const buttonAlt = !chatReady ? "Loading" : inProgress ? "Stop" : "Send"

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text])

  function send() {
    const message = text.trim()
    if (!message || inProgress) return
    onSend(message)
    setText("")
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <div className="copilotKitInputContainer">
      <div className="mrr-composer">
        <div className="mrr-composer-main">
          <textarea
            ref={textareaRef}
            data-testid="copilot-chat-textarea"
            rows={1}
            value={text}
            placeholder="Describe a coding task…"
            onChange={(e) => setText(e.target.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isComposing) {
                e.preventDefault()
                if (canSend) send()
              }
            }}
          />
        </div>

        <div className="mrr-composer-controls">
          <ModePill run={run} flows={flows} onManageFlows={onManageFlows} />
          {run.flow ? (
            <div className="flex min-w-0 items-center gap-1">
              {run.flowProviders.slice(0, 5).map((p, i) => (
                <div key={p} className="flex items-center gap-1">
                  {i > 0 && <span className="text-[11px] text-muted-foreground">→</span>}
                  <ProviderPill provider={p} />
                </div>
              ))}
            </div>
          ) : (
            <>
              <ModelCombobox
                compact
                value={run.selectedModel}
                provider={run.active.provider}
                catalog={run.catalog}
                align="start"
                onSelect={({ model, provider }) => run.setModel(model, provider)}
              />
              <EffortPill session={run.active} onEffort={run.setEffort} />
              {run.active.provider === "codex" && run.fastModels.includes(run.selectedModel) && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-pressed={run.active.fast}
                  onClick={() => run.setFast(!run.active.fast)}
                  className={cn(
                    "rounded-full text-[11px]",
                    run.active.fast && "border-amber-400/50 bg-amber-400/10 text-amber-400 hover:text-amber-400",
                  )}
                  title="Fast service tier"
                >
                  <Zap className="size-3" />
                  Fast
                </Button>
              )}
              <RolePill role={run.active.role} onRole={run.setRole} />
            </>
          )}
          <div className="copilotKitInputControls mrr-composer-send">
            <button
              type="button"
              disabled={sendDisabled}
              onClick={() => (inProgress ? onStop?.() : send())}
              data-copilotkit-in-progress={inProgress}
              data-testid="copilot-send-button"
              data-test-id={inProgress ? "copilot-chat-request-in-progress" : "copilot-chat-ready"}
              className="copilotKitInputControlButton"
              aria-label={buttonAlt}
            >
              {buttonIcon}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModePill({
  run,
  flows,
  onManageFlows,
}: {
  run: ReturnType<typeof useRunConfig>
  flows: FlowConfig[]
  onManageFlows: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="xs" className="rounded-full text-[11px]">
          {run.flow ? <Workflow className="size-3" /> : <Zap className="size-3 text-amber-400" />}
          <span className="max-w-[12ch] truncate">{run.flow ? run.flow.name : "Single"}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={run.selectSingle} className="gap-2">
          <Zap className="size-4 text-amber-400" />
          <div className="grid">
            <span>Single agent</span>
            <span className="text-xs text-muted-foreground">Pick a model and run</span>
          </div>
          {!run.flow && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
        </DropdownMenuItem>
        {flows.length > 0 && <DropdownMenuSeparator />}
        {flows.length > 0 && <DropdownMenuLabel className="text-xs text-muted-foreground">Flows</DropdownMenuLabel>}
        {flows.map((flow) => (
          <DropdownMenuItem key={flow.id} onClick={() => run.selectFlow(flow.id)} className="gap-2">
            <Workflow className="size-4 text-muted-foreground" />
            <span className="truncate">{flow.name}</span>
            {run.flow?.id === flow.id && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onManageFlows} className="gap-2">
          <Settings2 className="size-4" />
          Manage flows…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EffortPill({
  session,
  onEffort,
}: {
  session: SessionConfig
  onEffort: (effort: Effort | null) => void
}) {
  const label = session.effort ? effortLabel(session.provider, session.effort) : "default"
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="xs" className="rounded-full text-[11px]" title="Reasoning effort">
          <Brain className="size-3" />
          <span>{label}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1">
        <PillOption selected={!session.effort} onClick={() => onEffort(null)}>
          Default effort
        </PillOption>
        {effortsFor(session.provider).map((effort) => (
          <PillOption key={effort} selected={session.effort === effort} onClick={() => onEffort(effort)}>
            {effortLabel(session.provider, effort)}
          </PillOption>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function RolePill({ role, onRole }: { role: string; onRole: (role: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="xs" className="rounded-full text-[11px]" title="Agent role">
          <Bot className="size-3" />
          <span className="max-w-[12ch] truncate">{roleName(role)}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        {ROLES.map((r) => (
          <button
            key={r.id}
            type="button"
            className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
            onClick={() => onRole(r.id)}
          >
            <Check className={cn("mt-0.5 size-3.5", role === r.id ? "opacity-100" : "opacity-0")} />
            <span className="grid gap-0.5">
              <span>{r.name}</span>
              <span className="text-xs text-muted-foreground">{r.description}</span>
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function PillOption({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={onClick}>
      <Check className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")} />
      <span>{children}</span>
    </button>
  )
}
