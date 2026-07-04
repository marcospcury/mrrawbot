import { useEffect, useState } from "react"
import { Bot, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  ROLE_IDS,
  BUILD_ROLES,
  effortLabel,
  effortsFor,
  roleName,
  type AgentConfig,
  type Effort,
  type ModelEntry,
  type NewAgentConfig,
  type Provider,
} from "@shared/types"
import { cn } from "@/lib/utils"
import { providerMeta } from "@/lib/format"
import { useAgentMutations, useAgents, useModels } from "@/lib/queries"
import { ModelCombobox } from "@/components/model-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

interface Draft {
  name: string
  provider: Provider
  model: string
  effort: Effort | null
  role: string
  systemPrompt: string
  maxIterations: string
  temperature: string
}

const EMPTY_DRAFT: Draft = {
  name: "",
  provider: "claude",
  model: "",
  effort: null,
  role: "",
  systemPrompt: "",
  maxIterations: "10",
  temperature: "",
}

function toDraft(a: AgentConfig): Draft {
  return {
    name: a.name,
    provider: a.provider,
    model: a.model,
    effort: a.effort,
    role: a.role,
    systemPrompt: a.systemPrompt,
    maxIterations: String(a.maxIterations),
    temperature: a.temperature == null ? "" : String(a.temperature),
  }
}

// Select sentinel for an agent with no role — its system prompt is the whole prompt.
const CUSTOM_ROLE = "__custom__"

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

function ProviderTag({ provider }: { provider: Provider }) {
  const meta = providerMeta(provider)
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none",
        meta.className,
      )}
    >
      {meta.short}
    </span>
  )
}

function AgentModelCombobox({
  value,
  provider,
  catalog,
  onSelect,
}: {
  value: string
  provider: Provider
  catalog: ModelEntry[]
  onSelect: (model: string, provider: Provider) => void
}) {
  return (
    <ModelCombobox
      value={value}
      provider={provider}
      catalog={catalog}
      placeholder="model id"
      onSelect={({ model, provider: nextProvider }) => onSelect(model, nextProvider)}
    />
  )
}

export function AgentsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const agentsQuery = useAgents()
  const modelsQuery = useModels()
  const { create, update, remove } = useAgentMutations()

  const agents = agentsQuery.data ?? []
  const modelCatalog = modelsQuery.data ?? []
  const [selected, setSelected] = useState<string | "new" | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)

  useEffect(() => {
    if (!open) setSelected(null)
  }, [open])

  useEffect(() => {
    if (!open || selected !== null || agentsQuery.isLoading) return
    const first = agents[0]
    if (first) {
      setSelected(first.id)
      setDraft(toDraft(first))
    } else {
      setSelected("new")
      setDraft(EMPTY_DRAFT)
    }
  }, [open, selected, agents, agentsQuery.isLoading])

  const editingAgent =
    selected !== null && selected !== "new" ? agents.find((a) => a.id === selected) : undefined
  const isBuiltin = editingAgent?.isBuiltin ?? false
  const saving = create.isPending || update.isPending
  const deleting = remove.isPending

  function selectAgent(a: AgentConfig) {
    setSelected(a.id)
    setDraft(toDraft(a))
  }

  function newAgent() {
    setSelected("new")
    setDraft(EMPTY_DRAFT)
  }

  async function handleSave() {
    const name = draft.name.trim()
    const model = draft.model.trim()
    if (!name) {
      toast.error("Name is required")
      return
    }
    if (!model) {
      toast.error("Model is required")
      return
    }
    const tempStr = draft.temperature.trim()
    const temperature = tempStr === "" ? null : Number(tempStr)
    if (temperature !== null && (Number.isNaN(temperature) || temperature < 0 || temperature > 2)) {
      toast.error("Temperature must be between 0 and 2")
      return
    }
    const payload: NewAgentConfig = {
      name,
      provider: draft.provider,
      model,
      effort: draft.effort,
      role: draft.role.trim(),
      systemPrompt: draft.systemPrompt,
      maxIterations: clampInt(parseInt(draft.maxIterations, 10), 1, 100, 10),
      temperature,
    }
    try {
      if (selected === "new" || selected === null) {
        const created = await create.mutateAsync(payload)
        selectAgent(created)
        toast.success("Agent created")
      } else {
        const updated = await update.mutateAsync({ id: selected, ...payload })
        setDraft(toDraft(updated))
        toast.success("Agent saved")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save agent")
    }
  }

  async function handleDelete(agent: AgentConfig) {
    try {
      await remove.mutateAsync(agent.id)
      toast.success("Agent deleted")
      const remaining = agents.filter((a) => a.id !== agent.id)
      if (remaining[0]) selectAgent(remaining[0])
      else newAgent()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete agent")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] w-[min(calc(100vw-2rem),72rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="size-4" /> Agents
          </DialogTitle>
          <DialogDescription>
            Configure the agents your flows can orchestrate. Every agent has full access to the repository.
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[min(42rem,calc(100vh-10rem))] min-h-0">
          <div className="flex w-64 shrink-0 flex-col border-r border-border">
            <div className="p-2">
              <Button variant="outline" size="sm" className="w-full justify-start" onClick={newAgent}>
                <Plus /> New agent
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-1 px-2 pb-2">
                {agents.map((a) => {
                  const active = selected === a.id
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => selectAgent(a)}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors",
                        active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{a.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <ProviderTag provider={a.provider} />
                        {a.role && (
                          <span className="truncate text-xs text-muted-foreground">{roleName(a.role)}</span>
                        )}
                      </div>
                    </button>
                  )
                })}
                {agents.length === 0 && !agentsQuery.isLoading && (
                  <p className="px-2.5 py-2 text-xs text-muted-foreground">No agents yet.</p>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 p-6">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="agent-name">Name</Label>
                  <Input
                    id="agent-name"
                    value={draft.name}
                    placeholder="e.g. Planner"
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 flex flex-col gap-1.5">
                    <Label htmlFor="agent-model">Model</Label>
                    <AgentModelCombobox
                      value={draft.model}
                      provider={draft.provider}
                      catalog={modelCatalog}
                      onSelect={(model, provider) =>
                        setDraft((d) => {
                          const effort = d.effort && effortsFor(provider).includes(d.effort) ? d.effort : null
                          return { ...d, model, provider, effort }
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="agent-effort">Effort</Label>
                    <Select
                      value={draft.effort ?? "default"}
                      onValueChange={(v) =>
                        setDraft((d) => ({ ...d, effort: v === "default" ? null : (v as Effort) }))
                      }
                    >
                      <SelectTrigger id="agent-effort" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Default</SelectItem>
                        {effortsFor(draft.provider).map((e) => (
                          <SelectItem key={e} value={e}>
                            {effortLabel(draft.provider, e)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="agent-role">Role</Label>
                  <Select
                    value={ROLE_IDS.includes(draft.role) ? draft.role : CUSTOM_ROLE}
                    onValueChange={(v) => setDraft((d) => ({ ...d, role: v === CUSTOM_ROLE ? "" : v }))}
                  >
                    <SelectTrigger id="agent-role" className="w-full">
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
                  <p className="text-xs text-muted-foreground">
                    The role supplies a full, provider-adapted system prompt. Pick “Custom” to write your own.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="agent-prompt">
                    {draft.role ? "Additional instructions (optional)" : "System prompt"}
                  </Label>
                  <Textarea
                    id="agent-prompt"
                    value={draft.systemPrompt}
                    placeholder={
                      draft.role
                        ? "Optional notes layered on top of the role's prompt…"
                        : "Instructions that define how this agent behaves…"
                    }
                    className="min-h-40"
                    onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="agent-iter">Max iterations</Label>
                    <Input
                      id="agent-iter"
                      type="number"
                      min={1}
                      max={100}
                      value={draft.maxIterations}
                      onChange={(e) => setDraft((d) => ({ ...d, maxIterations: e.target.value }))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="agent-temp">Temperature</Label>
                    <Input
                      id="agent-temp"
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      placeholder="default"
                      value={draft.temperature}
                      onChange={(e) => setDraft((d) => ({ ...d, temperature: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
              <div>
                {isBuiltin && (
                  <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    built-in
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {editingAgent && !isBuiltin && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="icon" aria-label="Delete agent" disabled={deleting}>
                        <Trash2 />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent size="sm">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete agent?</AlertDialogTitle>
                        <AlertDialogDescription>
                          "{editingAgent.name}" will be permanently removed. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleDelete(editingAgent)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="animate-spin" />}
                  {selected === "new" ? "Create agent" : "Save changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
