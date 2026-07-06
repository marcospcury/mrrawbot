import { PROVIDERS, type ModelEntry, type Provider } from "@shared/types"

export function resolveProvider(modelId: string, catalog: ModelEntry[]): Provider {
  return catalog.find((m) => m.id === modelId)?.provider ?? "claude"
}

export function sortModels(catalog: ModelEntry[]): ModelEntry[] {
  return [...catalog].sort((a, b) => {
    if (a.hidden !== b.hidden) return a.hidden ? 1 : -1
    if (a.available !== b.available) return a.available ? -1 : 1
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    const provider = PROVIDERS.indexOf(a.provider) - PROVIDERS.indexOf(b.provider)
    if (provider !== 0) return provider
    return a.id.localeCompare(b.id, undefined, { sensitivity: "base", numeric: true })
  })
}

export function shortModelName(model: string): string {
  // Drop the vendor/org prefix ("anthropic/...", "Qwen/...", "moonshotai/...")
  // — the provider dot next to the pill already carries the identity.
  return model
    .replace(/^[\w.-]+\//, "")
    .replace(/:cloud$/, "")
    .replace(/-cloud$/, "")
}
