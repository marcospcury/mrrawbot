import type { Provider } from "@shared/types"

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ""
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const diff = Date.now() - then
  const s = Math.floor(diff / 1000)
  if (s < 45) return "just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w ago`
  return new Date(iso).toLocaleDateString()
}

export function durationLabel(startedAt?: number | null, endedAt?: number | null): string {
  if (!startedAt) return ""
  const end = endedAt ?? Date.now()
  const ms = Math.max(0, end - startedAt)
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

interface ProviderMeta {
  label: string
  short: string
  className: string
  /** Tailwind background class for the provider's identity dot. */
  dotClassName: string
}

const PROVIDER_META: Record<Provider, ProviderMeta> = {
  claude: {
    label: "Claude Code",
    short: "Claude",
    className: "text-orange-400 border-orange-500/30 bg-orange-500/10",
    dotClassName: "bg-orange-400",
  },
  codex: {
    label: "Codex",
    short: "Codex",
    className: "text-sky-400 border-sky-500/30 bg-sky-500/10",
    dotClassName: "bg-sky-400",
  },
  ollama: {
    label: "Ollama Cloud",
    short: "Ollama",
    className: "text-violet-400 border-violet-500/30 bg-violet-500/10",
    dotClassName: "bg-violet-400",
  },
  openrouter: {
    label: "OpenRouter",
    short: "OpenRouter",
    className: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
    dotClassName: "bg-cyan-400",
  },
  huggingface: {
    label: "Hugging Face",
    short: "HF",
    className: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    dotClassName: "bg-amber-400",
  },
  cerebras: {
    label: "Cerebras",
    short: "Cerebras",
    className: "text-rose-400 border-rose-500/30 bg-rose-500/10",
    dotClassName: "bg-rose-400",
  },
}

export function providerMeta(p: Provider): ProviderMeta {
  return PROVIDER_META[p]
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}
