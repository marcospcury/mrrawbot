import { lazy, Suspense, type ReactNode, useEffect, useState } from "react"
import { Check, Key, Monitor, Moon, Settings, Sun } from "reicon-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import type { Provider, ProviderConfig, ProviderConfigPatch, ProviderStatus } from "@shared/types"
import { FileIcon } from "@/lib/file-icons"
import { providerMeta } from "@/lib/format"
import { useInfo, useProviderConfig, useProviders, useUpdateProviderConfig } from "@/lib/queries"
import { useAppearance, type FileIconTheme } from "@/components/appearance-provider"
import { useTheme } from "@/components/theme-provider"

// The editor theme picker renders live CodeMirror previews — load that (and
// every bundled color theme) only when the Appearance tab is opened.
const EditorThemeSettings = lazy(() => import("@/components/editor-theme-settings"))
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const

/** The one configurable field each provider exposes in Settings. */
interface ProviderField {
  key: keyof ProviderConfigPatch
  label: string
  /** Secret fields render as password inputs and never echo the stored value. */
  secret: boolean
}

const PROVIDER_FIELDS: Record<Provider, ProviderField> = {
  claude: { key: "claudeBinPath", label: "Claude Code CLI path", secret: false },
  codex: { key: "codexBinPath", label: "Codex CLI path", secret: false },
  ollama: { key: "ollamaApiKey", label: "Ollama Cloud API key", secret: true },
  openrouter: { key: "openrouterApiKey", label: "OpenRouter API key", secret: true },
  huggingface: { key: "huggingfaceApiKey", label: "Hugging Face access token", secret: true },
  cerebras: { key: "cerebrasApiKey", label: "Cerebras API key", secret: true },
}

function fieldState(provider: Provider, config: ProviderConfig): { stored: boolean; placeholder: string } {
  switch (provider) {
    case "claude":
      return {
        stored: config.claudeBinPathStored,
        placeholder: config.claudeBinPathStored ? "" : `auto-detected: ${config.claudeBinPath}`,
      }
    case "codex":
      return {
        stored: config.codexBinPathStored,
        placeholder: config.codexBinPathStored ? "" : `auto-detected: ${config.codexBinPath}`,
      }
    case "ollama":
      return { stored: config.ollamaApiKeyStored, placeholder: keyPlaceholder(config.ollamaApiKeySet) }
    case "openrouter":
      return { stored: config.openrouterApiKeyStored, placeholder: keyPlaceholder(config.openrouterApiKeySet) }
    case "huggingface":
      return { stored: config.huggingfaceApiKeyStored, placeholder: keyPlaceholder(config.huggingfaceApiKeySet) }
    case "cerebras":
      return { stored: config.cerebrasApiKeyStored, placeholder: keyPlaceholder(config.cerebrasApiKeySet) }
  }
}

function keyPlaceholder(set: boolean): string {
  return set ? "configured — enter a new key to replace" : "not set"
}

function ProviderCard({ status, config }: { status: ProviderStatus; config: ProviderConfig }) {
  const update = useUpdateProviderConfig()
  const meta = providerMeta(status.provider)
  const field = PROVIDER_FIELDS[status.provider]
  const { stored, placeholder } = fieldState(status.provider, config)
  const [value, setValue] = useState("")

  // Re-seed whenever fresh config arrives (e.g. dialog reopened). Secrets
  // never echo back; path fields show the stored override for editing.
  useEffect(() => {
    if (field.secret) setValue("")
    else setValue(stored ? (status.provider === "claude" ? config.claudeBinPath : config.codexBinPath) : "")
  }, [config, field.secret, status.provider, stored])

  const save = () => {
    const next = value.trim()
    // Secrets are only touched when a new one is typed; paths save as typed
    // (blank clears the override back to auto-detection).
    if (field.secret && !next) return
    update.mutate(
      { [field.key]: next || null },
      {
        onSuccess: () => toast.success(`${meta.label} configuration saved`),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  const clear = () => {
    update.mutate(
      { [field.key]: null },
      {
        onSuccess: () => toast.success(`${meta.label} ${field.secret ? "key removed" : "path reset"}`),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  const inputId = `provider-${status.provider}`

  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className={cn("size-2 shrink-0 rounded-full", meta.dotClassName)} aria-hidden />
          {meta.label}
          <span
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none",
              status.available
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-amber-500/30 bg-amber-500/10 text-amber-500",
            )}
          >
            {status.available ? "ready" : "not set up"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {status.detail && <p className="text-sm text-muted-foreground">{status.detail}</p>}
        {status.configHint && <p className="text-xs text-amber-500">{status.configHint}</p>}
        <div className="space-y-1.5 pt-1">
          <Label htmlFor={inputId} className="flex items-center gap-1.5 text-xs">
            <Key className="size-3" /> {field.label}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id={inputId}
              type={field.secret ? "password" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className="font-mono text-xs"
            />
            <Button type="button" size="sm" onClick={save} disabled={update.isPending || (field.secret && !value.trim())}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
            {stored && (
              <Button type="button" variant="outline" size="sm" onClick={clear} disabled={update.isPending}>
                Remove
              </Button>
            )}
          </div>
        </div>
        {status.models.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {status.models.slice(0, 4).map((m) => (
              <Badge key={m} variant="outline" className="font-mono text-[10px]">
                {m}
              </Badge>
            ))}
            {status.models.length > 4 && (
              <span className="text-xs text-muted-foreground">+{status.models.length - 4} more</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const ICON_THEME_OPTIONS: { value: FileIconTheme; label: string; description: string }[] = [
  { value: "colored", label: "Colored", description: "Per-filetype icons and colors" },
  { value: "monochrome", label: "Monochrome", description: "Flat, single-color icons" },
]

const ICON_SAMPLE: { name: string; type: "file" | "dir"; open?: boolean }[] = [
  { name: "src", type: "dir", open: true },
  { name: "app.tsx", type: "file" },
  { name: "styles.css", type: "file" },
  { name: "package.json", type: "file" },
  { name: "README.md", type: "file" },
]

function FileIconSettings() {
  const { fileIconTheme, setFileIconTheme } = useAppearance()
  return (
    <div className="grid grid-cols-2 gap-3">
      {ICON_THEME_OPTIONS.map((opt) => {
        const active = fileIconTheme === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setFileIconTheme(opt.value)}
            aria-pressed={active}
            className={cn(
              "overflow-hidden rounded-lg border text-left transition-colors",
              active ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/30",
            )}
          >
            <div className="space-y-1 p-3" aria-hidden>
              {ICON_SAMPLE.map((entry) => (
                <div key={entry.name} className={cn("flex items-center gap-1.5 text-xs", entry.type === "file" && "pl-4")}>
                  <FileIcon name={entry.name} type={entry.type} open={entry.open} theme={opt.value} className="size-3.5" />
                  {entry.name}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t bg-background px-2.5 py-1.5">
              <span className="text-xs font-medium">{opt.label}</span>
              <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                {opt.description}
                {active && <Check className="size-3.5 text-primary" />}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="font-mono text-xs break-all text-foreground sm:max-w-[60%] sm:text-right">
        {children}
      </div>
    </div>
  )
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const providersQuery = useProviders()
  const providerConfigQuery = useProviderConfig(open)
  const infoQuery = useInfo()
  const { theme, resolvedTheme, setTheme } = useTheme()

  const providers = providersQuery.data ?? []
  const info = infoQuery.data

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] w-[min(calc(100vw-2rem),70rem)] flex-col overflow-hidden sm:max-w-none">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="size-4" /> Settings
          </DialogTitle>
          <DialogDescription>Providers, appearance, and app information.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="providers" className="min-h-0 w-full flex-1">
          <TabsList className="w-full shrink-0">
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>

          <TabsContent value="providers" className="min-h-0">
            <ScrollArea className="h-[min(42rem,calc(100vh-14rem))]">
              <div className="space-y-3 pr-3">
                <p className="text-xs text-muted-foreground">
                  Keys and paths are stored encrypted in the local database. Providers without
                  credentials stay visible but can’t run until set up.
                </p>
                {providerConfigQuery.data &&
                  providers.map((p) => (
                    <ProviderCard key={p.provider} status={p} config={providerConfigQuery.data} />
                  ))}
                {providers.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {providersQuery.isLoading ? "Loading providers…" : "No providers configured."}
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="appearance" className="min-h-0">
            <ScrollArea className="h-[min(42rem,calc(100vh-14rem))]">
              <div className="space-y-6 py-2 pr-3">
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">App theme</h3>
                  <div className="grid grid-cols-3 gap-3">
                    {THEME_OPTIONS.map((opt) => {
                      const Icon = opt.icon
                      const active = theme === opt.value
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setTheme(opt.value)}
                          className={cn(
                            "relative flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                            active
                              ? "border-primary bg-accent text-accent-foreground"
                              : "border-border hover:bg-muted",
                          )}
                        >
                          {active && <Check className="absolute top-2 right-2 size-3.5 text-primary" />}
                          <Icon className="size-5" />
                          <span className="text-sm font-medium">{opt.label}</span>
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Currently using{" "}
                    <span className="font-medium text-foreground">{resolvedTheme}</span> mode
                    {theme === "system" ? " (following your system)." : "."}
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Editor theme</h3>
                  <Suspense
                    fallback={<p className="py-4 text-sm text-muted-foreground">Loading theme previews…</p>}
                  >
                    <EditorThemeSettings />
                  </Suspense>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">File explorer icons</h3>
                  <FileIconSettings />
                </section>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="about" className="min-h-0">
            <ScrollArea className="h-[min(42rem,calc(100vh-14rem))]">
              <div className="py-2 pr-3">
                {info ? (
                  <div>
                    <InfoRow label="App">
                      {info.name} <span className="text-muted-foreground">v{info.version}</span>
                    </InfoRow>
                    <InfoRow label="Repo roots">
                      {info.repoRoots.length > 0 ? (
                        <div className="space-y-0.5">
                          {info.repoRoots.map((root) => (
                            <div key={root}>{root}</div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">none</span>
                      )}
                    </InfoRow>
                    <InfoRow label="Database">{info.dbPath}</InfoRow>
                    <InfoRow label="Copilot runtime">{info.copilotRuntimeUrl}</InfoRow>
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {infoQuery.isLoading ? "Loading…" : "App info unavailable."}
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
