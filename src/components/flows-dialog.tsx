import { useEffect, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Repeat,
  Trash2,
  Workflow,
} from "lucide-react"
import { toast } from "sonner"

import type { Effort, FlowConfig, FlowStep, ModelEntry, NewFlowConfig, Provider } from "@shared/types"
import { BUILD_ROLES, DEFAULT_ROLE_ID, ROLE_IDS, effortsFor, effortLabel } from "@shared/types"
import { cn } from "@/lib/utils"
import { providerMeta } from "@/lib/format"
import { useAgents, useFlowMutations, useFlows, useModels } from "@/lib/queries"
import { ModelCombobox } from "@/components/model-combobox"
import { ProviderPill } from "@/components/provider-pill"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

interface FlowDraft {
  name: string
  description: string
  steps: FlowStep[]
}

const EMPTY_FLOW: FlowDraft = { name: "", description: "", steps: [] }

// Select sentinel for "no role" — the step's instructions are then the whole prompt.
const CUSTOM_ROLE = "__custom__"

function toDraft(f: FlowConfig): FlowDraft {
  return { name: f.name, description: f.description, steps: f.steps.map((s) => ({ ...s })) }
}

function blankStep(provider: Provider = "claude"): FlowStep {
  return {
    id: crypto.randomUUID(),
    name: providerMeta(provider).short,
    provider,
    model: "",
    effort: null,
    fast: false,
    role: DEFAULT_ROLE_ID,
    systemPrompt: "",
    maxIterations: 14,
    temperature: null,
    mode: "single",
    maxCompletionPasses: 10,
    loop: null,
  }
}

export function FlowsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const flowsQuery = useFlows()
  const agentsQuery = useAgents()
  const modelsQuery = useModels()
  const { create, update, remove } = useFlowMutations()

  const flows = flowsQuery.data ?? []
  const agents = agentsQuery.data ?? []
  const modelCatalog = modelsQuery.data ?? []

  const [selected, setSelected] = useState<string | "new" | null>(null)
  const [draft, setDraft] = useState<FlowDraft>(EMPTY_FLOW)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) setSelected(null)
  }, [open])

  useEffect(() => {
    if (!open || selected !== null || flowsQuery.isLoading) return
    const first = flows[0]
    if (first) loadFlow(first)
    else newFlow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected, flows, flowsQuery.isLoading])

  const editingFlow = selected !== null && selected !== "new" ? flows.find((f) => f.id === selected) : undefined
  const isBuiltin = editingFlow?.isBuiltin ?? false
  const saving = create.isPending || update.isPending
  const deleting = remove.isPending

  function loadFlow(f: FlowConfig) {
    setSelected(f.id)
    setDraft(toDraft(f))
    setExpanded(new Set(f.steps.length === 1 ? f.steps.map((s) => s.id) : []))
  }

  function newFlow() {
    const first = blankStep("claude")
    setSelected("new")
    setDraft({ name: "", description: "", steps: [first] })
    setExpanded(new Set([first.id]))
  }

  function setSteps(updater: (steps: FlowStep[]) => FlowStep[]) {
    setDraft((d) => ({ ...d, steps: updater(d.steps) }))
  }

  function patchStep(index: number, patch: Partial<FlowStep>) {
    setSteps((steps) => steps.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function changeStepModel(index: number, model: string, provider: Provider) {
    setSteps((steps) =>
      steps.map((s, i) => {
        if (i !== index) return s
        const effort = s.effort && effortsFor(provider).includes(s.effort) ? s.effort : null
        return { ...s, provider, model, effort, fast: provider === "codex" ? s.fast : false }
      }),
    )
  }

  function addStep(step: FlowStep) {
    setSteps((steps) => [...steps, step])
    setExpanded((e) => new Set(e).add(step.id))
  }

  function insertFromTemplate(agentId: string) {
    const a = agents.find((x) => x.id === agentId)
    if (!a) return
    addStep({
      id: crypto.randomUUID(),
      name: a.name,
      provider: a.provider,
      model: a.model,
      effort: a.effort,
      fast: false,
      role: a.role,
      systemPrompt: a.systemPrompt,
      maxIterations: a.maxIterations,
      temperature: a.temperature,
      mode: "single",
      maxCompletionPasses: 10,
      loop: null,
    })
  }

  function removeStep(index: number) {
    setSteps((steps) => steps.filter((_, i) => i !== index))
  }

  function moveStep(index: number, dir: -1 | 1) {
    setSteps((steps) => {
      const next = [...steps]
      const target = index + dir
      if (target < 0 || target >= next.length) return steps
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function toggleExpand(id: string) {
    setExpanded((e) => {
      const next = new Set(e)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    const name = draft.name.trim()
    if (!name) return toast.error("Name is required")
    if (draft.steps.length === 0) return toast.error("Add at least one step")
    if (draft.steps.some((s) => !s.model.trim())) return toast.error("Every step needs a model")

    const payload: NewFlowConfig = {
      name,
      description: draft.description.trim(),
      steps: draft.steps.map((s) => ({
        ...s,
        name: s.name.trim() || providerMeta(s.provider).short,
        mode: s.mode ?? "single",
        maxCompletionPasses: Math.max(1, s.maxCompletionPasses ?? 10),
        loop: s.loop && s.loop.to ? { ...s.loop, maxLoops: Math.max(1, s.loop.maxLoops) } : null,
      })),
    }
    try {
      if (selected === "new" || selected === null) {
        const created = await create.mutateAsync(payload)
        loadFlow(created)
        toast.success("Flow created")
      } else {
        const updated = await update.mutateAsync({ id: selected, ...payload })
        setDraft(toDraft(updated))
        toast.success("Flow saved")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save flow")
    }
  }

  async function handleDelete(flow: FlowConfig) {
    try {
      await remove.mutateAsync(flow.id)
      toast.success("Flow deleted")
      const remaining = flows.filter((f) => f.id !== flow.id)
      if (remaining[0]) loadFlow(remaining[0])
      else newFlow()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete flow")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] w-[min(calc(100vw-2rem),86rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="size-4" /> Flows
          </DialogTitle>
          <DialogDescription>
            Each step picks its own provider, model and reasoning effort — mix them freely.
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[min(48rem,calc(100vh-10rem))] min-h-0">
          {/* flow list */}
          <div className="flex w-72 shrink-0 flex-col border-r">
            <div className="p-2">
              <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={newFlow}>
                <Plus className="size-4" /> New flow
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-1 px-2 pb-2">
                {flows.map((f) => {
                  const providers = Array.from(new Set(f.steps.map((s) => s.provider)))
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => loadFlow(f)}
                      className={cn(
                        "flex w-full flex-col gap-1.5 rounded-md px-2.5 py-2 text-left transition-colors",
                        selected === f.id ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{f.name}</span>
                        {f.isBuiltin && <BuiltinBadge />}
                      </div>
                      {f.description && (
                        <span className="line-clamp-1 text-xs text-muted-foreground">{f.description}</span>
                      )}
                      <div className="flex flex-wrap items-center gap-1">
                        {providers.map((p) => (
                          <ProviderPill key={p} provider={p} />
                        ))}
                      </div>
                    </button>
                  )
                })}
              </div>
            </ScrollArea>
          </div>

          {/* editor */}
          <div className="flex min-w-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-5 p-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="flow-name">Name</Label>
                    <Input
                      id="flow-name"
                      value={draft.name}
                      placeholder="e.g. Plan → Build → Review"
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="flow-desc">Description</Label>
                    <Input
                      id="flow-desc"
                      value={draft.description}
                      placeholder="What this flow is for…"
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    />
                  </div>
                </div>

                {draft.steps.length > 0 && <Pipeline steps={draft.steps} />}

                <div className="flex flex-col gap-2.5">
                  <Label>Steps</Label>
                  {draft.steps.map((step, index) => (
                    <StepCard
                      key={step.id}
                      step={step}
                      index={index}
                      total={draft.steps.length}
                      steps={draft.steps}
                      open={expanded.has(step.id)}
                      modelCatalog={modelCatalog}
                      onToggle={() => toggleExpand(step.id)}
                      onPatch={(patch) => patchStep(index, patch)}
                      onChangeModel={(model, provider) => changeStepModel(index, model, provider)}
                      onMove={(dir) => moveStep(index, dir)}
                      onRemove={() => removeStep(index)}
                    />
                  ))}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => addStep(blankStep())}>
                      <Plus className="size-4" /> Add step
                    </Button>
                    {agents.length > 0 && (
                      <Select value="" onValueChange={insertFromTemplate}>
                        <SelectTrigger size="sm" className="w-[200px]">
                          <SelectValue placeholder="Insert from template…" />
                        </SelectTrigger>
                        <SelectContent>
                          {agents.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              <span className="flex items-center gap-1.5">
                                {a.name}
                                <ProviderPill provider={a.provider} />
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between gap-2 border-t px-6 py-4">
              <div>{isBuiltin && <BuiltinBadge />}</div>
              <div className="flex items-center gap-2">
                {editingFlow && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="icon" aria-label="Delete flow" disabled={deleting}>
                        <Trash2 className="size-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete flow?</AlertDialogTitle>
                        <AlertDialogDescription>
                          “{editingFlow.name}” will be permanently removed. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-white hover:bg-destructive/90"
                          onClick={() => handleDelete(editingFlow)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {selected === "new" ? "Create flow" : "Save changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StepCard({
  step,
  index,
  total,
  steps,
  open,
  modelCatalog,
  onToggle,
  onPatch,
  onChangeModel,
  onMove,
  onRemove,
}: {
  step: FlowStep
  index: number
  total: number
  steps: FlowStep[]
  open: boolean
  modelCatalog: ModelEntry[]
  onToggle: () => void
  onPatch: (patch: Partial<FlowStep>) => void
  onChangeModel: (model: string, provider: Provider) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const efforts = effortsFor(step.provider)
  const otherSteps = steps.filter((s) => s.id !== step.id)

  return (
    <div className="overflow-hidden rounded-lg border">
      {/* header */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[11px] text-muted-foreground">
            {index + 1}
          </span>
          <span className="truncate text-sm font-medium">{step.name || providerMeta(step.provider).short}</span>
          <ProviderPill provider={step.provider} model={step.model || undefined} />
          {step.effort && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {effortLabel(step.provider, step.effort)}
            </span>
          )}
          {step.loop && <Repeat className="size-3 text-muted-foreground" />}
        </button>
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Move down"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Remove step" onClick={onRemove}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t bg-muted/20 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Role">
              <Select
                value={ROLE_IDS.includes(step.role) ? step.role : CUSTOM_ROLE}
                onValueChange={(v) => onPatch({ role: v === CUSTOM_ROLE ? "" : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUILD_ROLES.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_ROLE}>Custom</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Name">
              <Input
                value={step.name}
                placeholder="e.g. Planner"
                onChange={(e) => onPatch({ name: e.target.value })}
              />
            </Field>
            <Field label="Model">
              <ModelCombobox
                value={step.model}
                provider={step.provider}
                catalog={modelCatalog}
                placeholder="model id"
                onSelect={({ model, provider }) => onChangeModel(model, provider)}
              />
            </Field>
            <Field label="Effort">
              <Select
                value={step.effort ?? "default"}
                onValueChange={(v) => onPatch({ effort: v === "default" ? null : (v as Effort) })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  {efforts.map((e) => (
                    <SelectItem key={e} value={e}>
                      {effortLabel(step.provider, e)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Execution">
              <Select
                value={step.mode ?? "single"}
                onValueChange={(v) => onPatch({ mode: v as FlowStep["mode"] })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single run</SelectItem>
                  <SelectItem value="plan-executor">Plan executor</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label={step.role ? "Extra instructions (optional)" : "Instructions"}>
            <Textarea
              value={step.systemPrompt}
              placeholder={
                step.role
                  ? "Optional notes layered on top of the role's prompt…"
                  : "What this agent should do…"
              }
              className="min-h-20"
              onChange={(e) => onPatch({ systemPrompt: e.target.value })}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Max iterations</span>
              <Input
                type="number"
                min={1}
                max={100}
                value={step.maxIterations}
                className="h-8 w-20"
                onChange={(e) => onPatch({ maxIterations: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
            </div>
            {(step.mode ?? "single") === "plan-executor" && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Completion passes</span>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={step.maxCompletionPasses ?? 10}
                  className="h-8 w-20"
                  onChange={(e) => onPatch({ maxCompletionPasses: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                />
              </div>
            )}
          </div>

          {/* loop / reviewer */}
          {otherSteps.length > 0 && (
            <div className="rounded-md border bg-background/40 p-2.5">
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Repeat className="size-3.5" /> Loop back to an earlier step until approved
                </span>
                <Switch
                  checked={!!step.loop}
                  onCheckedChange={(v) =>
                    onPatch({ loop: v ? { to: otherSteps[0].id, approveWhen: "APPROVE", maxLoops: 2 } : null })
                  }
                />
              </label>
              {step.loop && (
                <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Field label="Loop to" small>
                    <Select
                      value={step.loop.to}
                      onValueChange={(v) => onPatch({ loop: { ...step.loop!, to: v } })}
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue placeholder="Select step" />
                      </SelectTrigger>
                      <SelectContent>
                        {otherSteps.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Approve when" small>
                    <Input
                      value={step.loop.approveWhen}
                      className="h-8"
                      onChange={(e) => onPatch({ loop: { ...step.loop!, approveWhen: e.target.value } })}
                    />
                  </Field>
                  <Field label="Max loops" small>
                    <Input
                      type="number"
                      min={1}
                      className="h-8"
                      value={step.loop.maxLoops}
                      onChange={(e) =>
                        onPatch({ loop: { ...step.loop!, maxLoops: Math.max(1, parseInt(e.target.value, 10) || 1) } })
                      }
                    />
                  </Field>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Pipeline({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Pipeline</Label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-3">
        {steps.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <span className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-1 text-xs">
              {s.name || providerMeta(s.provider).short}
              <ProviderPill provider={s.provider} />
            </span>
          </span>
        ))}
        {steps.some((s) => s.loop?.to) && (
          <span className="ml-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Repeat className="size-3" /> with review loop
          </span>
        )}
      </div>
    </div>
  )
}

function Field({ label, small, children }: { label: string; small?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className={cn("text-muted-foreground", small ? "text-xs" : "text-xs")}>{label}</Label>
      {children}
    </div>
  )
}

function BuiltinBadge() {
  return (
    <span className="shrink-0 rounded-md border bg-muted px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
      built-in
    </span>
  )
}
