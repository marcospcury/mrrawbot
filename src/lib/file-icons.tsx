import {
  Braces,
  Container,
  Database,
  File,
  FileArchive,
  FileCode2,
  FileCog,
  FileImage,
  FileLock2,
  FileText,
  FileType2,
  Folder,
  FolderOpen,
  Palette,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react"
import type { FileIconTheme } from "@/components/appearance-provider"
import { cn } from "@/lib/utils"

interface IconSpec {
  icon: LucideIcon
  className: string
}

// Special filenames first, then extensions. Colors lean on the conventions
// developers already know (TS blue, JS yellow, CSS purple, …).
const NAME_ICONS: Record<string, IconSpec> = {
  "package.json": { icon: Braces, className: "text-amber-500" },
  "package-lock.json": { icon: Braces, className: "text-amber-500/70" },
  dockerfile: { icon: Container, className: "text-sky-500" },
  makefile: { icon: SquareTerminal, className: "text-stone-500" },
}

const EXT_ICONS: Record<string, IconSpec> = {
  ts: { icon: FileCode2, className: "text-blue-500" },
  mts: { icon: FileCode2, className: "text-blue-500" },
  cts: { icon: FileCode2, className: "text-blue-500" },
  tsx: { icon: FileCode2, className: "text-blue-400" },
  js: { icon: FileCode2, className: "text-yellow-500" },
  mjs: { icon: FileCode2, className: "text-yellow-500" },
  cjs: { icon: FileCode2, className: "text-yellow-500" },
  jsx: { icon: FileCode2, className: "text-yellow-400" },
  json: { icon: Braces, className: "text-amber-500" },
  jsonc: { icon: Braces, className: "text-amber-500" },
  md: { icon: FileText, className: "text-sky-400" },
  mdx: { icon: FileText, className: "text-sky-400" },
  txt: { icon: FileText, className: "text-muted-foreground" },
  css: { icon: Palette, className: "text-violet-500" },
  scss: { icon: Palette, className: "text-pink-500" },
  less: { icon: Palette, className: "text-violet-400" },
  html: { icon: FileCode2, className: "text-orange-500" },
  vue: { icon: FileCode2, className: "text-emerald-500" },
  svelte: { icon: FileCode2, className: "text-orange-600" },
  png: { icon: FileImage, className: "text-emerald-500" },
  jpg: { icon: FileImage, className: "text-emerald-500" },
  jpeg: { icon: FileImage, className: "text-emerald-500" },
  gif: { icon: FileImage, className: "text-emerald-500" },
  webp: { icon: FileImage, className: "text-emerald-500" },
  ico: { icon: FileImage, className: "text-emerald-500" },
  svg: { icon: FileImage, className: "text-teal-500" },
  yml: { icon: FileCog, className: "text-teal-500" },
  yaml: { icon: FileCog, className: "text-teal-500" },
  toml: { icon: FileCog, className: "text-teal-500" },
  ini: { icon: FileCog, className: "text-teal-500" },
  env: { icon: FileCog, className: "text-teal-500" },
  sh: { icon: SquareTerminal, className: "text-green-500" },
  bash: { icon: SquareTerminal, className: "text-green-500" },
  zsh: { icon: SquareTerminal, className: "text-green-500" },
  ps1: { icon: SquareTerminal, className: "text-blue-400" },
  sql: { icon: Database, className: "text-rose-400" },
  db: { icon: Database, className: "text-rose-400" },
  sqlite: { icon: Database, className: "text-rose-400" },
  py: { icon: FileCode2, className: "text-cyan-500" },
  go: { icon: FileCode2, className: "text-cyan-600" },
  rs: { icon: FileCode2, className: "text-orange-400" },
  rb: { icon: FileCode2, className: "text-red-400" },
  java: { icon: FileCode2, className: "text-red-500" },
  kt: { icon: FileCode2, className: "text-purple-500" },
  swift: { icon: FileCode2, className: "text-orange-500" },
  c: { icon: FileCode2, className: "text-blue-600" },
  h: { icon: FileCode2, className: "text-blue-600" },
  cpp: { icon: FileCode2, className: "text-blue-600" },
  hpp: { icon: FileCode2, className: "text-blue-600" },
  cs: { icon: FileCode2, className: "text-violet-600" },
  php: { icon: FileCode2, className: "text-indigo-400" },
  lock: { icon: FileLock2, className: "text-stone-400" },
  pdf: { icon: FileText, className: "text-red-500" },
  zip: { icon: FileArchive, className: "text-yellow-600" },
  tar: { icon: FileArchive, className: "text-yellow-600" },
  gz: { icon: FileArchive, className: "text-yellow-600" },
  woff: { icon: FileType2, className: "text-stone-400" },
  woff2: { icon: FileType2, className: "text-stone-400" },
  ttf: { icon: FileType2, className: "text-stone-400" },
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
