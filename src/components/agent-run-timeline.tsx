import { useState } from "react"
import { AlertCircle, Check, ChevronDown, ChevronRight, Hierarchy2 } from "reicon-react"
import { CircleDashed } from "lucide-react"
import type { AgentRunState, RunStep } from "@shared/types"
import { DotMatrixLoader } from "@/components/dot-matrix-loader"
import { ProviderPill } from "@/components/provider-pill"
import { durationLabel } from "@/lib/format"
import { cn } from "@/lib/utils"

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function usageLabel(usage: RunStep["usage"]): string | null {
  if (!usage) return null
  const parts: string[] = []
  if (usage.inputTokens && usage.inputTokens > 0) parts.push(`${formatTokenCount(usage.inputTokens)} in`)
  if (usage.outputTokens && usage.outputTokens > 0) parts.push(`${formatTokenCount(usage.outputTokens)} out`)
  if (parts.length === 0 && usage.totalTokens && usage.totalTokens > 0) return `${formatTokenCount(usage.totalTokens)} tok`
  return parts.length > 0 ? parts.join(" · ") : null
}

export function AgentRunTimeline({
  state,
  status,
}: {
  state: AgentRunState
  status: "inProgress" | "complete"
}) {
  // The CoAgent render can fire with a partial/empty state before the first
  // STATE_SNAPSHOT arrives — bail out until we have real steps.
  if (!state || !Array.isArray(state.steps) || state.steps.length === 0) return null

  const running = status === "inProgress" && state.status === "running"

  return (
    <div className="animate-mrr-in my-2 w-full overflow-hidden rounded-xl border bg-card/60 text-card-foreground shadow-sm">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Hierarchy2 className="size-4 text-muted-foreground" />
        <span className={cn("text-sm font-medium", running && "mrr-shimmer")}>{state.flowName}</span>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {running ? null : state.status === "error" ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <AlertCircle className="size-3.5" /> Failed
            </span>
          ) : state.status === "cancelled" ? (
            <span>Cancelled</span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Check className="size-3.5" /> Done
            </span>
          )}
          <span>{running ? "" : "· "}{durationLabel(state.startedAt, state.endedAt)}</span>
        </div>
      </div>

      <div className="divide-y">
        {state.steps.map((step, i) => (
          <StepRow key={step.id} step={step} isLast={i === state.steps.length - 1} />
        ))}
      </div>

      {state.error && (
        <div className="border-t bg-destructive/10 px-3 py-2 text-xs text-destructive">{state.error}</div>
      )}
    </div>
  )
}

function StepRow({ step, isLast }: { step: RunStep; isLast: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null)
  // Default-open the active step and any errored step; collapse completed ones.
  const expanded = open ?? (step.status === "running" || step.status === "error")
  const hasBody = step.output.length > 0 || step.logs.length > 0
  const isChild = step.id.includes("#")
  const tokens = usageLabel(step.usage)

  return (
    <div className={cn("px-3 py-2.5", isChild && "pl-8")}>
      <button
        type="button"
        onClick={() => hasBody && setOpen(!expanded)}
        className={cn("flex w-full items-center gap-2.5 text-left", !hasBody && "cursor-default")}
      >
        <StepIcon status={step.status} isLast={isLast} />
        <span className="text-sm font-medium">{step.agentName}</span>
        {!isChild && <ProviderPill provider={step.provider} model={step.model} />}
        {step.iteration > 1 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            pass {step.iteration}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {tokens && <span>{tokens}</span>}
          {step.usage?.costUsd != null && step.usage.costUsd > 0 && (
            <span>${step.usage.costUsd.toFixed(2)}</span>
          )}
          {(step.startedAt || step.endedAt) && step.status !== "pending" && (
            <span>{durationLabel(step.startedAt, step.endedAt)}</span>
          )}
          {hasBody &&
            (expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />)}
        </div>
      </button>

      {expanded && hasBody && (
        <div className="mt-2 space-y-2 pl-[26px]">
          {step.logs.length > 0 && (
            <div className="space-y-0.5">
              {step.logs.slice(-6).map((log, i) => (
                <div key={i} className="truncate font-mono text-[11px] text-muted-foreground">
                  {log}
                </div>
              ))}
            </div>
          )}
          {step.output && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background/60 p-2.5 font-mono text-xs leading-relaxed text-foreground/90">
              {step.output}
              {step.status === "running" && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
            </pre>
          )}
          {step.error && <div className="text-xs text-destructive">{step.error}</div>}
        </div>
      )}
    </div>
  )
}

function StepIcon({ status, isLast }: { status: RunStep["status"]; isLast: boolean }) {
  return (
    <span className="relative flex size-[18px] shrink-0 items-center justify-center">
      {!isLast && <span className="absolute left-1/2 top-[18px] h-[calc(100%+10px)] w-px -translate-x-1/2 bg-border" />}
      {status === "running" ? (
        <DotMatrixLoader boxSize={18} className="text-foreground" />
      ) : status === "done" ? (
        <Check className="size-[18px] rounded-full bg-emerald-500/15 p-0.5 text-emerald-400" />
      ) : status === "error" ? (
        <AlertCircle className="size-[18px] text-destructive" />
      ) : (
        <CircleDashed className="size-[18px] text-muted-foreground/60" />
      )}
    </span>
  )
}
