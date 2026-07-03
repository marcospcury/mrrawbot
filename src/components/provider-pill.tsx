import type { Provider } from "@shared/types"
import { cn } from "@/lib/utils"
import { providerMeta } from "@/lib/format"

export function ProviderPill({
  provider,
  model,
  className,
}: {
  provider: Provider
  model?: string
  className?: string
}) {
  const meta = providerMeta(provider)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        meta.className,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-80" />
      {meta.short}
      {model ? <span className="font-normal opacity-60">· {model}</span> : null}
    </span>
  )
}
