import { useMemo } from "react"
import {
  defaultSession,
  effortsFor,
  type Effort,
  type FlowConfig,
  type ModelEntry,
  type Provider,
  type SessionConfig,
} from "@shared/types"
import { resolveProvider } from "@/lib/models"
import { useModels } from "@/lib/queries"

export interface RunConfig {
  flowId: string | null
  session: SessionConfig | null
}

export function useRunConfig({
  flows,
  flowId,
  session,
  onChangeRun,
}: {
  flows: FlowConfig[]
  flowId: string | null
  session: SessionConfig | null
  onChangeRun: (next: RunConfig) => void
}) {
  const modelsQuery = useModels()
  const catalog = modelsQuery.data ?? []
  const active = session ?? defaultSession()
  const flow = flowId ? flows.find((f) => f.id === flowId) ?? null : null
  const selectedModel = active.model || defaultModelFor(active.provider, catalog)
  const fastModels = catalog.filter((m) => m.provider === "codex" && m.fast).map((m) => m.id)

  const flowProviders = useMemo(() => {
    if (!flow) return []
    const seen = new Set<Provider>()
    const out: Provider[] = []
    for (const s of flow.steps) {
      if (!seen.has(s.provider)) {
        seen.add(s.provider)
        out.push(s.provider)
      }
    }
    return out
  }, [flow])

  // Flow providers that aren't set up yet: the flow stays selectable, but the
  // run will be refused server-side until these are configured (or swapped).
  const unavailableFlowProviders = useMemo(() => {
    if (catalog.length === 0) return [] // catalog still loading — don't flag anything
    return flowProviders.filter((p) => !catalog.some((m) => m.provider === p && m.available))
  }, [flowProviders, catalog])

  function setSession(next: SessionConfig) {
    onChangeRun({ flowId: null, session: next })
  }

  function selectSingle() {
    onChangeRun({ flowId: null, session: session ?? defaultSession() })
  }

  function selectFlow(nextFlowId: string) {
    onChangeRun({ flowId: nextFlowId, session })
  }

  function setModel(model: string, provider = resolveProvider(model, catalog)) {
    const effort = active.effort && effortsFor(provider).includes(active.effort) ? active.effort : null
    setSession({ ...active, provider, model, effort, fast: provider === "codex" ? active.fast : false })
  }

  function setEffort(effort: Effort | null) {
    setSession({ ...active, effort })
  }

  function setRole(role: string) {
    setSession({ ...active, role })
  }

  function setFast(fast: boolean) {
    setSession({ ...active, fast })
  }

  return {
    active,
    catalog,
    fastModels,
    flow,
    flowProviders,
    unavailableFlowProviders,
    selectedModel,
    selectSingle,
    selectFlow,
    setModel,
    setEffort,
    setRole,
    setFast,
  }
}

function defaultModelFor(provider: Provider, catalog: ModelEntry[]): string {
  return (
    catalog.find((m) => m.provider === provider && m.isDefault)?.id ??
    catalog.find((m) => m.provider === provider)?.id ??
    ""
  )
}
