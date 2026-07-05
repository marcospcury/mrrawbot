import type { ComponentType } from "react"
import { Box2, CodeFile, Database, File, FileText, FileZip, Folder, FolderOpen, Gallery, Gear, Lock, Palette, TerminalSquare, Text } from "reicon-react"
import { Braces } from "lucide-react"
import type { FileIconTheme } from "@/components/appearance-provider"
import { cn } from "@/lib/utils"

interface IconSpec {
  // Mixed sources: reicon components plus the lucide holdout (Braces).
  icon: ComponentType<{ className?: string }>
  className: string
}

// Special filenames first, then extensions. Colors lean on the conventions
// developers already know (TS blue, JS yellow, CSS purple, …).
const NAME_ICONS: Record<string, IconSpec> = {
  "package.json": { icon: Braces, className: "text-amber-500" },
  "package-lock.json": { icon: Braces, className: "text-amber-500/70" },
  dockerfile: { icon: Box2, className: "text-sky-500" },
  makefile: { icon: TerminalSquare, className: "text-stone-500" },
}

const EXT_ICONS: Record<string, IconSpec> = {
  ts: { icon: CodeFile, className: "text-blue-500" },
  mts: { icon: CodeFile, className: "text-blue-500" },
  cts: { icon: CodeFile, className: "text-blue-500" },
  tsx: { icon: CodeFile, className: "text-blue-400" },
  js: { icon: CodeFile, className: "text-yellow-500" },
  mjs: { icon: CodeFile, className: "text-yellow-500" },
  cjs: { icon: CodeFile, className: "text-yellow-500" },
  jsx: { icon: CodeFile, className: "text-yellow-400" },
  json: { icon: Braces, className: "text-amber-500" },
  jsonc: { icon: Braces, className: "text-amber-500" },
  md: { icon: FileText, className: "text-sky-400" },
  mdx: { icon: FileText, className: "text-sky-400" },
  txt: { icon: FileText, className: "text-muted-foreground" },
  css: { icon: Palette, className: "text-violet-500" },
  scss: { icon: Palette, className: "text-pink-500" },
  less: { icon: Palette, className: "text-violet-400" },
  html: { icon: CodeFile, className: "text-orange-500" },
  vue: { icon: CodeFile, className: "text-emerald-500" },
  svelte: { icon: CodeFile, className: "text-orange-600" },
  png: { icon: Gallery, className: "text-emerald-500" },
  jpg: { icon: Gallery, className: "text-emerald-500" },
  jpeg: { icon: Gallery, className: "text-emerald-500" },
  gif: { icon: Gallery, className: "text-emerald-500" },
  webp: { icon: Gallery, className: "text-emerald-500" },
  ico: { icon: Gallery, className: "text-emerald-500" },
  svg: { icon: Gallery, className: "text-teal-500" },
  yml: { icon: Gear, className: "text-teal-500" },
  yaml: { icon: Gear, className: "text-teal-500" },
  toml: { icon: Gear, className: "text-teal-500" },
  ini: { icon: Gear, className: "text-teal-500" },
  env: { icon: Gear, className: "text-teal-500" },
  sh: { icon: TerminalSquare, className: "text-green-500" },
  bash: { icon: TerminalSquare, className: "text-green-500" },
  zsh: { icon: TerminalSquare, className: "text-green-500" },
  ps1: { icon: TerminalSquare, className: "text-blue-400" },
  sql: { icon: Database, className: "text-rose-400" },
  db: { icon: Database, className: "text-rose-400" },
  sqlite: { icon: Database, className: "text-rose-400" },
  py: { icon: CodeFile, className: "text-cyan-500" },
  go: { icon: CodeFile, className: "text-cyan-600" },
  rs: { icon: CodeFile, className: "text-orange-400" },
  rb: { icon: CodeFile, className: "text-red-400" },
  java: { icon: CodeFile, className: "text-red-500" },
  kt: { icon: CodeFile, className: "text-purple-500" },
  swift: { icon: CodeFile, className: "text-orange-500" },
  c: { icon: CodeFile, className: "text-blue-600" },
  h: { icon: CodeFile, className: "text-blue-600" },
  cpp: { icon: CodeFile, className: "text-blue-600" },
  hpp: { icon: CodeFile, className: "text-blue-600" },
  cs: { icon: CodeFile, className: "text-violet-600" },
  php: { icon: CodeFile, className: "text-indigo-400" },
  lock: { icon: Lock, className: "text-stone-400" },
  pdf: { icon: FileText, className: "text-red-500" },
  zip: { icon: FileZip, className: "text-yellow-600" },
  tar: { icon: FileZip, className: "text-yellow-600" },
  gz: { icon: FileZip, className: "text-yellow-600" },
  woff: { icon: Text, className: "text-stone-400" },
  woff2: { icon: Text, className: "text-stone-400" },
  ttf: { icon: Text, className: "text-stone-400" },
}

function coloredSpec(name: string): IconSpec {
  const lower = name.toLowerCase()
  const byName = NAME_ICONS[lower]
  if (byName) return byName
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : ""
  return EXT_ICONS[ext] ?? { icon: File, className: "text-muted-foreground" }
}

export function FileIcon({
  name,
  type,
  open = false,
  theme,
  className,
}: {
  name: string
  type: "file" | "dir"
  open?: boolean
  theme: FileIconTheme
  className?: string
}) {
  if (type === "dir") {
    const Icon = open ? FolderOpen : Folder
    return (
      <Icon
        className={cn(
          "size-4 shrink-0",
          theme === "colored" ? "text-amber-400 dark:text-amber-300/90" : "text-muted-foreground",
          className,
        )}
      />
    )
  }
  const spec = theme === "colored" ? coloredSpec(name) : { icon: File, className: "text-muted-foreground" }
  const Icon = spec.icon
  return <Icon className={cn("size-4 shrink-0", spec.className, className)} />
}
