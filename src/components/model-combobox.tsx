import { useMemo, useState } from "react"
import { Check, ChevronDown, Zap } from "lucide-react"
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

const PROVIDER_DOT: Record<Provider, string> = {
  claude: "bg-orange-400",
  codex: "bg-sky-400",
  ollama: "bg-violet-400",
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
  const sorted = useMemo(() => sortModels(catalog), [catalog])
  const visible = sorted.filter((m) => !m.hidden)
  const hidden = sorted.filter((m) => m.hidden)
  const exact = catalog.some((m) => m.id.toLowerCase() === search.trim().toLowerCase())
  const selectedProvider = provider ?? catalog.find((m) => m.id === value)?.provider

  function choose(model: string, nextProvider: Provider) {
    onSelect({ model, provider: nextProvider })
    setOpen(false)
    setSearch("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between gap-2", compact ? "h-6 rounded-full px-2 text-[11px]" : "w-full", triggerClassName)}
          title={value || placeholder}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {selectedProvider && <span className={cn("size-2 shrink-0 rounded-full", PROVIDER_DOT[selectedProvider])} />}
            <span className={cn("truncate", compact && "mrr-pill-label")}>{value ? shortModelName(value) : placeholder}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className={cn("w-[25rem] p-0", className)}>
        <Command shouldFilter>
          <CommandInput placeholder="Search or type a model id…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandGroup>
              {visible.map((entry) => (
                <ModelRow key={`${entry.provider}:${entry.id}`} entry={entry} selected={entry.id === value && entry.provider === selectedProvider} onChoose={choose} />
              ))}
            </CommandGroup>
            {hidden.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="More">
                  {hidden.map((entry) => (
                    <ModelRow key={`${entry.provider}:${entry.id}`} entry={entry} selected={entry.id === value && entry.provider === selectedProvider} onChoose={choose} />
                  ))}
                </CommandGroup>
              </>
            )}
            {search.trim() && !exact && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Use typed model">
                  {PROVIDERS.map((p) => (
                    <CommandItem key={p} value={`Use ${search} with ${providerMeta(p).label}`} onSelect={() => choose(search.trim(), p)}>
                      <span className={cn("size-2 shrink-0 rounded-full", PROVIDER_DOT[p])} />
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
    <CommandItem value={`${entry.id} ${providerMeta(entry.provider).label}`} onSelect={() => onChoose(entry.id, entry.provider)} className={cn(!entry.available && "text-muted-foreground")}>
      <Check className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")} />
      <span className={cn("size-2 shrink-0 rounded-full", PROVIDER_DOT[entry.provider])} />
      <span className="min-w-0 flex-1 truncate">{entry.id}</span>
      {entry.fast && <Zap className="size-3.5 text-amber-400" />}
      {entry.hidden && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">hidden</span>}
      {!entry.available && <span className="text-[10px] text-muted-foreground">{providerMeta(entry.provider).short}: login needed</span>}
    </CommandItem>
  )
}
