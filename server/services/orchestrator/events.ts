import type { Effort, Provider, StepUsage } from "@shared/types.ts"

/** Internal events emitted by orchestrator nodes, consumed by the AG-UI adapter. */
export type OrchEvent =
  | {
      type: "step_start"
      stepId: string
      iteration: number
      title?: string
      provider?: Provider
      model?: string
      effort?: Effort | null
    }
  | { type: "token"; stepId: string; text: string }
  | { type: "log"; stepId: string; text: string }
  | { type: "tool"; stepId: string; tool: { id: string; name: string; args?: unknown; result?: string } }
  | { type: "step_output"; stepId: string; text: string }
  | { type: "step_end"; stepId: string; status: "done" | "error"; error?: string; usage?: StepUsage | null }

export type Emit = (event: OrchEvent) => void
