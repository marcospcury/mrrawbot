import { type ReactNode, useEffect, useState } from "react"
import { Check, KeyRound, Monitor, Moon, Settings, Sun } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import type { ProviderConfig, ProviderConfigPatch } from "@shared/types"
import { useInfo, useProviderConfig, useProviders, useUpdateProviderConfig } from "@/lib/queries"
import { useTheme } from "@/components/theme-provider"
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

function ProviderConfigForm({ config }: { config: ProviderConfig }) {
  const update = useUpdateProviderConfig()
  const [claudeBinPath, setClaudeBinPath] = useState("")
  const [codexBinPath, setCodexBinPath] = useState("")
  const [ollamaApiKey, setOllamaApiKey] = useState("")

  // Re-seed the form whenever fresh config arrives (e.g. dialog reopened).
  useEffect(() => {
    setClaudeBinPath(config.claudeBinPathStored ? config.claudeBinPath : "")
    setCodexBinPath(config.codexBinPathStored ? config.codexBinPath : "")
    setOllamaApiKey("")
  }, [config])

  const save = () => {
    const patch: ProviderConfigPatch = {
      claudeBinPath: claudeBinPath.trim() || null,
      codexBinPath: codexBinPath.trim() || null,
    }
    // Only touch the key when the user typed one or explicitly cleared a stored one.
    if (ollamaApiKey.trim()) patch.ollamaApiKey = ollamaApiKey.trim()
    update.mutate(patch, {
      onSuccess: () => toast.success("Provider configuration saved"),
      onError: (err) => toast.error(err.message),
    })
  }

  const clearKey = () => {
    update.mutate(
      { ollamaApiKey: null },
      {
        onSuccess: () => toast.success("Ollama API key removed"),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <KeyRound className="size-3.5" /> Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Stored encrypted in the local database. Leave a field blank to use auto-detection.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="claude-bin" className="text-xs">
            Claude Code CLI path
          </Label>
          <Input
            id="claude-bin"
            value={claudeBinPath}
            onChange={(e) => setClaudeBinPath(e.target.value)}
            placeholder={config.claudeBinPathStored ? "" : `auto-detected: ${config.claudeBinPath}`}
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="codex-bin" className="text-xs">
            Codex CLI path
          </Label>
          <Input
            id="codex-bin"
            value={codexBinPath}
            onChange={(e) => setCodexBinPath(e.target.value)}
            placeholder={config.codexBinPathStored ? "" : `auto-detected: ${config.codexBinPath}`}
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ollama-key" className="text-xs">
            Ollama Cloud API key
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="ollama-key"
              type="password"
              value={ollamaApiKey}
              onChange={(e) => setOllamaApiKey(e.target.value)}
              placeholder={config.ollamaApiKeySet ? "configured — enter a new key to replace" : "not set"}
              className="font-mono text-xs"
            />
            {config.ollamaApiKeyStored && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearKey}
                disabled={update.isPending}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="size-4" /> Settings
          </DialogTitle>
          <DialogDescription>Providers, appearance, and app information.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="providers" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>

          <TabsContent value="providers">
            <ScrollArea className="max-h-[26rem]">
              <div className="space-y-3 pr-2">
                {providerConfigQuery.data && <ProviderConfigForm config={providerConfigQuery.data} />}
                {providers.map((p) => (
                  <Card key={p.provider} className="gap-3 py-4">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            p.available ? "bg-emerald-500" : "bg-amber-500",
                          )}
                          aria-hidden
                        />
                        {p.label}
                        <span className="text-xs font-normal text-muted-foreground">
                          {p.available ? "available" : "unavailable"}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {p.detail && <p className="text-sm text-muted-foreground">{p.detail}</p>}
                      {p.configHint && <p className="text-xs text-amber-500">{p.configHint}</p>}
                      {p.models.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {p.models.slice(0, 4).map((m) => (
                            <Badge key={m} variant="outline" className="font-mono text-[10px]">
                              {m}
                            </Badge>
                          ))}
                          {p.models.length > 4 && (
                            <span className="text-xs text-muted-foreground">
                              +{p.models.length - 4} more
                            </span>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {providers.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {providersQuery.isLoading ? "Loading providers…" : "No providers configured."}
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="appearance">
            <div className="space-y-4 py-2">
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
            </div>
          </TabsContent>

          <TabsContent value="about">
            <div className="py-2">
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
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
