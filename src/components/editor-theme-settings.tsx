import { useEffect, useState } from "react"
import { LanguageDescription } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import CodeMirror from "@uiw/react-codemirror"
import { Check } from "lucide-react"
import { useAppearance } from "@/components/appearance-provider"
import { EDITOR_THEMES, type EditorThemeOption } from "@/lib/editor-themes"
import { cn } from "@/lib/utils"

const SAMPLE = `// Preview
export function greet(name: string) {
  const message = \`Hello, \${name}!\`
  if (!name.trim()) throw new Error("empty")
  return { message, at: Date.now() }
}`

const previewChrome: Extension = EditorView.theme({
  "&": { fontSize: "11px", fontFamily: "var(--font-mono)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "hidden" },
})

/**
 * Editor color theme pickers (light + dark) with live previews. Loaded lazily —
 * this pulls CodeMirror and every bundled color theme into the settings dialog.
 */
export default function EditorThemeSettings() {
  const { editorThemeLight, editorThemeDark, setEditorThemeLight, setEditorThemeDark } = useAppearance()
  const [language, setLanguage] = useState<Extension[]>([])

  useEffect(() => {
    let cancelled = false
    void LanguageDescription.matchFilename(languages, "sample.ts")
      ?.load()
      .then((support) => {
        if (!cancelled) setLanguage([support])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const group = (appearance: "light" | "dark", active: string, onSelect: (id: string) => void) => (
    <div className="space-y-2">
      <h4 className="text-sm font-medium capitalize">{appearance} mode theme</h4>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {EDITOR_THEMES.filter((t) => t.appearance === appearance).map((opt) => (
          <ThemeCard
            key={opt.id}
            option={opt}
            active={opt.id === active}
            language={language}
            onSelect={() => onSelect(opt.id)}
          />
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Applies to the file viewer and the changes diff. The matching theme is used automatically when the app
        switches between light and dark.
      </p>
      {group("light", editorThemeLight, setEditorThemeLight)}
      {group("dark", editorThemeDark, setEditorThemeDark)}
    </div>
  )
}

function ThemeCard({
  option,
  active,
  language,
  onSelect,
}: {
  option: EditorThemeOption
  active: boolean
  language: Extension[]
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "group overflow-hidden rounded-lg border text-left transition-colors",
        active ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/30",
      )}
    >
      <div className="pointer-events-none h-24 overflow-hidden" aria-hidden>
        <CodeMirror
          value={SAMPLE}
          readOnly
          editable={false}
          basicSetup={false}
          theme={option.extension}
          extensions={[...language, previewChrome]}
        />
      </div>
      <div className="flex items-center justify-between border-t bg-background px-2.5 py-1.5 text-xs font-medium">
        {option.label}
        {active && <Check className="size-3.5 text-primary" />}
      </div>
    </button>
  )
}
