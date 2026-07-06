import { useMemo, useState } from "react"
import { Check, ChevronDown, Flash2 } from "reicon-react"
import { PROVIDERS, type ModelEntry, type Provider } from "@shared/types"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { providerMeta } from "@/lib/format"
import { shortModelName, sortModels } from "@/lib/models"
import { cn } from "@/lib/utils"

function ProviderDot({ provider, className }: { provider: Provider; className?: string }) {
  return <span className={cn("size-2 shrink-0 rounded-full", providerMeta(provider).dotClassName, className)} />
}

export function ModelCombobox({
  value,
  provider,
  catalog,
  onSelect,
  className,
  triggerClassName,
  placeholder = "Select model",
  align = "start",
  compact = false,
}: {
  value: string
  provider?: Provider
  catalog: ModelEntry[]
  onSelect: (selection: { model: string; provider: Provider }) => void
  className?: string
  triggerClassName?: string
  placeholder?: string
  align?: "start" | "center" | "end"
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  // Only connected providers are offered: unconfigured providers' models are
  // hidden entirely (they can't run anyway — set them up in Settings first).
  const usable = useMemo(() => sortModels(catalog.filter((m) => m.available)), [catalog])
  const exact = usable.some((m) => m.id.toLowerCase() === search.trim().toLowerCase())
  const selectedProvider = provider ?? catalog.find((m) => m.id === value)?.provider

  // Group by provider (in canonical order) so the picker reads as one section
  // per provider instead of an anonymous model soup.
  const groups = useMemo(() => {
    const byProvider = new Map<Provider, ModelEntry[]>()
    for (const m of usable) {
      if (!byProvider.has(m.provider)) byProvider.set(m.provider, [])
      byProvider.get(m.provider)!.push(m)
    }
    return PROVIDERS.filter((p) => byProvider.has(p)).map((p) => ({
      provider: p,
      visible: byProvider.get(p)!.filter((m) => !m.hidden),
      hidden: byProvider.get(p)!.filter((m) => m.hidden),
    }))
  }, [usable])

  const typedModelProviders = useMemo(
    () => PROVIDERS.filter((p) => usable.some((m) => m.provider === p)),
    [usable],
  )

  function choose(model: string, nextProvider: Provider) {
    onSelect({ model, provider: nextProvider })
    setOpen(false)
    setSearch("")
  }

  return (
    // modal: the combobox renders inside modal dialogs (Agents, Flows), whose
    // scroll lock blocks wheel events on portalled popovers — modal mode adds
    // this popover to the scroll allowlist so the model list can scroll.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between gap-2", compact ? "h-6 rounded-full px-2 text-[11px]" : "w-full", triggerClassName)}
          title={selectedProvider ? `${providerMeta(selectedProvider).label} · ${value || placeholder}` : value || placeholder}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {selectedProvider && <ProviderDot provider={selectedProvider} />}
            {selectedProvider && !compact && (
              <span className="shrink-0 text-muted-foreground">{providerMeta(selectedProvider).short}</span>
            )}
            <span className={cn("truncate", compact && "mrr-pill-label")}>{value ? shortModelName(value) : placeholder}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className={cn("w-[25rem] p-0", className)}>
        <Command shouldFilter>
          <CommandInput placeholder="Search or type a model id…" value={search} onValueChange={setSearch} />
          <CommandList>
            {groups.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No providers connected yet — set one up in Settings → Providers.
              </p>
            )}
            {groups.map((group) => (
              <CommandGroup
                key={group.provider}
                heading={
                  <span className="flex items-center gap-1.5">
                    <ProviderDot provider={group.provider} className="size-1.5" />
                    {providerMeta(group.provider).label}
                  </span>
                }
              >
                {group.visible.map((entry) => (
                  <ModelRow
                    key={`${entry.provider}:${entry.id}`}
                    entry={entry}
                    selected={entry.id === value && entry.provider === selectedProvider}
                    onChoose={choose}
                  />
                ))}
              </CommandGroup>
            ))}
            {groups.some((g) => g.hidden.length > 0) && (
              <>
                <CommandSeparator />
                <CommandGroup heading="More">
                  {groups.flatMap((g) =>
                    g.hidden.map((entry) => (
                      <ModelRow
                        key={`${entry.provider}:${entry.id}`}
                        entry={entry}
                        selected={entry.id === value && entry.provider === selectedProvider}
                        onChoose={choose}
                      />
                    )),
                  )}
                </CommandGroup>
              </>
            )}
            {search.trim() && !exact && typedModelProviders.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Use typed model">
                  {typedModelProviders.map((p) => (
                    <CommandItem key={p} value={`Use ${search} with ${providerMeta(p).label}`} onSelect={() => choose(search.trim(), p)}>
                      <ProviderDot provider={p} />
                      <span className="truncate">Use “{search.trim()}” with {providerMeta(p).short}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ModelRow({
  entry,
  selected,
  onChoose,
}: {
  entry: ModelEntry
  selected: boolean
  onChoose: (model: string, provider: Provider) => void
}) {
  return (
    <CommandItem value={`${entry.id} ${providerMeta(entry.provider).label}`} onSelect={() => onChoose(entry.id, entry.provider)}>
      <Check className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")} />
      <ProviderDot provider={entry.provider} />
      <span className="min-w-0 flex-1 truncate">{entry.id}</span>
      {entry.fast && <Flash2 className="size-3.5 text-amber-400" />}
      {entry.hidden && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">hidden</span>}
    </CommandItem>
  )
}
